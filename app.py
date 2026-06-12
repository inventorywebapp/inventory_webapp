from flask import Flask, render_template, request, jsonify, redirect, url_for, flash, send_file
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from models import db, User, SKU, CountingSession, CountRecord, AuditLog, get_ph_time
from utils import check_recount_needed, sync_data_from_drive
from config import Config
import pandas as pd
from io import BytesIO
from datetime import datetime, timedelta
import os
import sys
from sqlalchemy import or_

app = Flask(__name__)
app.config.from_object(Config)

# Initialize extensions
db.init_app(app)
migrate = Migrate(app, db)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.session_protection = "strong"

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Create default admin user
def create_default_users():
    with app.app_context():
        db.create_all()
        
        if User.query.count() == 0:
            admin = User(
                username='admin',
                password=generate_password_hash('admin123'),
                full_name='System Administrator',
                role='admin',
                is_active=True
            )
            db.session.add(admin)
            
            staff = User(
                username='staff1',
                password=generate_password_hash('staff123'),
                full_name='Inventory Staff',
                role='staff',
                is_active=True
            )
            db.session.add(staff)
            
            audit = User(
                username='audit1',
                password=generate_password_hash('audit123'),
                full_name='Audit User',
                role='audit',
                is_active=True
            )
            db.session.add(audit)
            
            db.session.commit()
            print("Default users created!", file=sys.stderr)
        else:
            print(f"Database already has {User.query.count()} users", file=sys.stderr)

def auto_sync_if_empty():
    """Automatically sync if database is empty"""
    with app.app_context():
        if SKU.query.count() == 0:
            print("Database empty, auto-syncing from Google Drive...", file=sys.stderr)
            try:
                success = sync_data_from_drive()
                if success:
                    print("Auto-sync completed successfully!", file=sys.stderr)
                else:
                    print("Auto-sync failed. Please sync manually.", file=sys.stderr)
            except Exception as e:
                print(f"Auto-sync error: {e}", file=sys.stderr)

# Call the functions
create_default_users()
auto_sync_if_empty()

@app.teardown_appcontext
def shutdown_session(exception=None):
    """Close database session after each request"""
    db.session.remove()

@app.route('/')
@login_required
def index():
    if current_user.role == 'admin':
        return redirect(url_for('admin_dashboard'))
    elif current_user.role == 'audit':
        return redirect(url_for('audit_dashboard'))
    else:
        return redirect(url_for('counting'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = User.query.filter_by(username=username).first()
        
        if user and check_password_hash(user.password, password):
            login_user(user, remember=True)
            
            audit = AuditLog(
                user_id=user.id,
                action='Login',
                details=f'User {user.full_name} logged in',
                ip_address=request.remote_addr
            )
            db.session.add(audit)
            db.session.commit()
            
            return redirect(url_for('index'))
        else:
            flash('Invalid username or password', 'error')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    audit = AuditLog(
        user_id=current_user.id,
        action='Logout',
        details=f'User {current_user.full_name} logged out',
        ip_address=request.remote_addr
    )
    db.session.add(audit)
    db.session.commit()
    
    logout_user()
    return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    if current_user.role == 'audit':
        return redirect(url_for('audit_dashboard'))
    
    total_skus = SKU.query.count()
    active_sessions = CountingSession.query.filter_by(is_completed=False).count()
    day_categories = db.session.query(SKU.category).distinct().all()
    item_categories = db.session.query(SKU.description).distinct().all()
    warehouses = ['Main Warehouse', '5th Floor Warehouse']
    
    return render_template('dashboard.html',
                         total_skus=total_skus,
                         active_sessions=active_sessions,
                         day_categories=[c[0] for c in day_categories if c[0] and c[0] != ''],
                         item_categories=[c[0] for c in item_categories if c[0] and c[0] != ''],
                         warehouses=warehouses)

@app.route('/get_skus')
@login_required
def get_skus():
    """Get SKUs with filters - SMART LIMIT LOGIC"""
    day_category = request.args.get('day_category')
    item_category = request.args.get('item_category')
    search = request.args.get('search', '')
    
    query = SKU.query
    
    # Track if any filters are applied
    is_filtered = False
    
    # Apply filters only if not "All" or empty
    if day_category and day_category != 'All' and day_category != '-- All Day Categories --':
        query = query.filter(SKU.category == day_category)
        is_filtered = True
    
    if item_category and item_category != 'All' and item_category != '-- All Item Categories --':
        query = query.filter(SKU.description == item_category)
        is_filtered = True
    
    if search and search.strip():
        query = query.filter(
            or_(
                SKU.sku.contains(search), 
                SKU.description.contains(search)
            )
        )
        is_filtered = True
    
    # SMART LIMIT:
    # - If filters are applied, show ALL matching SKUs (user wants specific results)
    # - If no filters, limit to 1000 for performance (user is just browsing)
    if is_filtered:
        skus = query.all()
        print(f"Filtered query returned {len(skus)} SKUs", file=sys.stderr)
    else:
        skus = query.limit(1000).all()
        print(f"Unfiltered query (limited to 1000) returned {len(skus)} SKUs", file=sys.stderr)
    
    result = [{
        'id': s.id, 
        'sku': s.sku, 
        'description': s.description,
        'category': s.category, 
        'last_count_date': s.last_count_date,
        'last_count': s.last_count, 
        'total_container_qty': s.total_container_qty,
        'container_details': s.container_details, 
        'final_expected_count': s.final_expected_count,
        'kenneth_inventory': s.kenneth_inventory, 
        'stock_status': s.stock_status,
        'bypass_recount': s.bypass_recount
    } for s in skus]
    
    return jsonify(result)

@app.route('/search_suggestions')
@login_required
def search_suggestions():
    search_term = request.args.get('term', '')
    if len(search_term) < 2:
        return jsonify([])
    
    skus = SKU.query.filter(
        or_(
            SKU.sku.contains(search_term), 
            SKU.description.contains(search_term)
        )
    ).limit(10).all()
    
    return jsonify([{'sku': s.sku, 'description': s.description, 'id': s.id} for s in skus])

@app.route('/counting', methods=['GET', 'POST'])
@login_required
def counting():
    if current_user.role not in ['staff', 'admin']:
        flash('Access denied', 'error')
        return redirect(url_for('index'))
    
    if request.method == 'POST':
        data = request.json
        session_id = data.get('session_id')
        counts = data.get('counts', {})
        warehouse = data.get('warehouse')
        
        # Get or create session
        session_obj = CountingSession.query.get(session_id)
        if not session_obj:
            session_obj = CountingSession(user_id=current_user.id, warehouse=warehouse)
            db.session.add(session_obj)
            db.session.commit()
            session_id = session_obj.id
        
        # Process each SKU count
        recount_needed_skus = []
        for sku_id, count_data in counts.items():
            sku = SKU.query.get(int(sku_id))
            if not sku:
                continue
                
            initial_count = float(count_data.get('initial_count', 0))
            
            # Get the LATEST record for this SKU in this session to get version
            latest_record = CountRecord.query.filter_by(
                session_id=session_obj.id, 
                sku_id=int(sku_id)
            ).order_by(CountRecord.version.desc()).first()
            
            old_value = latest_record.initial_count if latest_record else None
            old_version = latest_record.version if latest_record else 0
            new_version = old_version + 1
            
            # Check if recount needed
            recount_needed = check_recount_needed(initial_count, sku.final_expected_count, sku.kenneth_inventory)
            
            # ALWAYS CREATE A NEW RECORD (version tracking)
            new_record = CountRecord(
                session_id=session_obj.id,
                sku_id=int(sku_id),
                initial_count=initial_count,
                is_recount_needed=recount_needed,
                count_time=get_ph_time(),
                version=new_version
            )
            db.session.add(new_record)
            
            if recount_needed:
                recount_needed_skus.append(sku.sku)
            
            # Log changes in AuditLog with version info
            if old_value is not None and old_value != initial_count:
                audit = AuditLog(
                    user_id=current_user.id,
                    action='Count Changed',
                    details=f'SKU {sku.sku}: version {old_version} count {old_value} → version {new_version} count {initial_count}',
                    ip_address=request.remote_addr
                )
                db.session.add(audit)
            else:
                audit = AuditLog(
                    user_id=current_user.id,
                    action='Count Added',
                    details=f'SKU {sku.sku}: version {new_version} count {initial_count}',
                    ip_address=request.remote_addr
                )
                db.session.add(audit)
        
        db.session.commit()
        
        # Log the save action
        audit = AuditLog(
            user_id=current_user.id,
            action='Initial Count Saved',
            details=f'Saved counts for {len(counts)} SKUs in session {session_obj.id}. Recount needed for {len(recount_needed_skus)} SKUs',
            ip_address=request.remote_addr
        )
        db.session.add(audit)
        db.session.commit()
        
        return jsonify({
            'success': True, 
            'session_id': session_obj.id,
            'recount_needed_count': len(recount_needed_skus),
            'recount_needed_skus': recount_needed_skus[:10]
        })
    
    # GET request - show counting page
    warehouses = ['Main Warehouse', '5th Floor Warehouse']
    day_categories = db.session.query(SKU.category).distinct().all()
    item_categories = db.session.query(SKU.description).distinct().all()
    
    # Filter out None/Empty values
    day_categories = [c[0] for c in day_categories if c[0] and c[0] != '']
    item_categories = [c[0] for c in item_categories if c[0] and c[0] != '']
    
    return render_template('counting.html',
                         warehouses=warehouses,
                         day_categories=day_categories,
                         item_categories=item_categories)

@app.route('/get_recount_list')
@login_required
def get_recount_list():
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify([])
    
    records = CountRecord.query.filter_by(
        session_id=session_id, 
        is_recount_needed=True, 
        recount_completed=False
    ).all()
    
    result = [{
        'id': r.id, 
        'sku_id': r.sku.id, 
        'sku': r.sku.sku, 
        'description': r.sku.description,
        'initial_count': r.initial_count, 
        'final_expected_count': r.sku.final_expected_count,
        'kenneth_inventory': r.sku.kenneth_inventory, 
        'remarks': r.remarks
    } for r in records]
    
    return jsonify(result)

@app.route('/save_recount', methods=['POST'])
@login_required
def save_recount():
    data = request.json
    for recount_data in data.get('recounts', []):
        record = CountRecord.query.get(recount_data.get('record_id'))
        if record:
            record.recount_count = float(recount_data.get('recount_count', 0))
            record.final_count = record.recount_count
            record.remarks = recount_data.get('remarks', '')
            record.recount_completed = True
            record.is_recount_needed = False
            
            audit = AuditLog(
                user_id=current_user.id,
                action='Recount Completed',
                details=f'SKU {record.sku.sku}: recount count = {record.recount_count}, reason: {record.remarks}',
                ip_address=request.remote_addr
            )
            db.session.add(audit)
    
    db.session.commit()
    return jsonify({'success': True})

@app.route('/check_recount_status', methods=['GET'])
@login_required
def check_recount_status():
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'has_pending_recounts': False})
    
    pending_count = CountRecord.query.filter_by(
        session_id=session_id,
        is_recount_needed=True,
        recount_completed=False
    ).count()
    
    return jsonify({'has_pending_recounts': pending_count > 0, 'count': pending_count})

@app.route('/get_latest_counts', methods=['GET'])
@login_required
def get_latest_counts():
    sku_ids = request.args.get('sku_ids', '')
    session_id = request.args.get('session_id')
    
    if not session_id or not sku_ids:
        return jsonify({})
    
    sku_id_list = sku_ids.split(',') if isinstance(sku_ids, str) else [sku_ids] if sku_ids else []
    
    result = {}
    for sku_id in sku_id_list:
        if not sku_id:
            continue
        latest = CountRecord.query.filter_by(
            session_id=session_id,
            sku_id=int(sku_id)
        ).order_by(CountRecord.version.desc()).first()
        
        if latest:
            result[sku_id] = {
                'initial_count': latest.initial_count,
                'version': latest.version,
                'count_time': latest.count_time.strftime('%Y-%m-%d %H:%M:%S')
            }
    
    return jsonify(result)

@app.route('/complete_counting', methods=['POST'])
@login_required
def complete_counting():
    session_id = request.json.get('session_id')
    if not session_id:
        return jsonify({'success': False, 'message': 'No session ID provided'}), 400
    
    pending_recounts = CountRecord.query.filter_by(
        session_id=session_id,
        is_recount_needed=True,
        recount_completed=False
    ).count()
    
    if pending_recounts > 0:
        return jsonify({
            'success': False, 
            'message': f'Cannot complete session. You have {pending_recounts} pending recount(s) that need to be completed first.'
        }), 400
    
    session_obj = CountingSession.query.get(session_id)
    if session_obj:
        session_obj.is_completed = True
        db.session.commit()
        
        audit = AuditLog(
            user_id=current_user.id,
            action='Complete Counting',
            details=f'Completed counting session {session_id}',
            ip_address=request.remote_addr
        )
        db.session.add(audit)
        db.session.commit()
        
        return jsonify({'success': True, 'message': 'Counting session completed successfully!'})
    return jsonify({'success': False, 'message': 'Session not found'}), 404

@app.route('/admin')
@login_required
def admin_dashboard():
    if current_user.role != 'admin':
        flash('Admin access required', 'error')
        return redirect(url_for('index'))
    
    users = User.query.all()
    sessions = CountingSession.query.order_by(CountingSession.session_date.desc()).limit(50).all()
    audit_logs = AuditLog.query.order_by(AuditLog.timestamp.desc()).limit(100).all()
    
    warehouses = ['Main Warehouse', '5th Floor Warehouse', 'All']
    day_categories = db.session.query(SKU.category).distinct().all()
    item_categories = db.session.query(SKU.description).distinct().all()
    
    day_categories = [c[0] for c in day_categories if c[0] and c[0] != '']
    item_categories = [c[0] for c in item_categories if c[0] and c[0] != '']
    
    return render_template('admin.html', 
                         users=users, 
                         sessions=sessions, 
                         audit_logs=audit_logs,
                         warehouses=warehouses,
                         day_categories=day_categories,
                         item_categories=item_categories)

@app.route('/export_counts', methods=['POST'])
@login_required
def export_counts():
    """Export count data - shows LATEST count from the MOST RECENT session for each SKU (No Version/Session ID)"""
    if current_user.role not in ['admin', 'audit']:
        flash('Access denied', 'error')
        return redirect(url_for('index'))
    
    try:
        # Get filter parameters
        filter_date = request.form.get('filter_date')
        filter_warehouse = request.form.get('filter_warehouse')
        filter_day_category = request.form.get('filter_day_category')
        filter_item_category = request.form.get('filter_item_category')
        
        # Get all SKUs based on filters
        sku_query = SKU.query
        
        if filter_day_category and filter_day_category != 'All':
            sku_query = sku_query.filter(SKU.category == filter_day_category)
        if filter_item_category and filter_item_category != 'All':
            sku_query = sku_query.filter(SKU.description == filter_item_category)
        
        all_skus_in_category = sku_query.all()
        
        # Get counting sessions
        session_query = CountingSession.query
        
        if filter_date and filter_date.strip():
            try:
                target_date = datetime.strptime(filter_date, '%Y-%m-%d')
                start_date = target_date.replace(hour=0, minute=0, second=0)
                end_date = target_date.replace(hour=23, minute=59, second=59)
                session_query = session_query.filter(CountingSession.session_date.between(start_date, end_date))
            except ValueError:
                pass
        
        if filter_warehouse and filter_warehouse != 'All':
            session_query = session_query.filter(CountingSession.warehouse == filter_warehouse)
        
        sessions = session_query.all()
        
        # For each SKU, find the LATEST record from the MOST RECENT session
        sku_latest = {}
        
        for sku in all_skus_in_category:
            best_record = None
            best_session = None
            
            for session_obj in sessions:
                # Get the latest version for this SKU in this session
                record = CountRecord.query.filter_by(
                    session_id=session_obj.id,
                    sku_id=sku.id
                ).order_by(CountRecord.version.desc()).first()
                
                if record:
                    if best_session is None or session_obj.session_date > best_session.session_date:
                        best_record = record
                        best_session = session_obj
            
            sku_latest[sku.id] = {
                'sku': sku,
                'record': best_record,
                'session': best_session
            }
        
        # Group by day category
        sheets_data = {}
        
        for sku_id, data in sku_latest.items():
            sku = data['sku']
            count_record = data['record']
            session_obj = data['session']
            
            day_category = sku.category or 'Uncategorized'
            
            if day_category not in sheets_data:
                sheets_data[day_category] = []
            
            if count_record and session_obj:
                # SKU was counted
                if count_record.recount_count and count_record.recount_count > 0:
                    final_count = count_record.recount_count
                else:
                    final_count = count_record.initial_count
                
                row_data = {
                    'SKU': str(sku.sku),
                    'Description': str(sku.description) if sku.description else '',
                    'Day Category': str(day_category),
                    'Count Status': 'COMPLETED',
                    'Initial Count': count_record.initial_count,
                    'Recount Count': count_record.recount_count if count_record.recount_count else '',
                    'Final Count': final_count,
                    'Remarks': str(count_record.remarks) if count_record.remarks else '',
                    'Date/Time Counted': count_record.count_time.strftime('%Y-%m-%d %H:%M:%S') if count_record.count_time else '',
                    'Counter': session_obj.user.full_name if session_obj.user else 'Unknown',
                    'Warehouse': session_obj.warehouse if session_obj.warehouse else '',
                    'Session Date': session_obj.session_date.strftime('%Y-%m-%d %H:%M:%S') if session_obj.session_date else '',
                    'Last Count Reference': sku.last_count,
                    'Last Count Date': str(sku.last_count_date) if sku.last_count_date else '',
                    'Final Expected Count': sku.final_expected_count,
                    'Kenneth Inventory': sku.kenneth_inventory
                }
            else:
                # SKU was NOT counted
                row_data = {
                    'SKU': str(sku.sku),
                    'Description': str(sku.description) if sku.description else '',
                    'Day Category': str(day_category),
                    'Count Status': '⚠️ NOT COUNTED ⚠️',
                    'Initial Count': 'NOT COUNTED',
                    'Recount Count': 'N/A',
                    'Final Count': 'PENDING',
                    'Remarks': 'SKU was not counted in this session',
                    'Date/Time Counted': 'NOT COUNTED',
                    'Counter': 'N/A',
                    'Warehouse': filter_warehouse if filter_warehouse and filter_warehouse != 'All' else 'All Warehouses',
                    'Session Date': 'N/A',
                    'Last Count Reference': sku.last_count,
                    'Last Count Date': str(sku.last_count_date) if sku.last_count_date else '',
                    'Final Expected Count': sku.final_expected_count,
                    'Kenneth Inventory': sku.kenneth_inventory
                }
            
            sheets_data[day_category].append(row_data)
        
        # Create Excel file
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            if sheets_data:
                for sheet_name, data in sheets_data.items():
                    safe_sheet_name = str(sheet_name)[:31].replace('/', '-').replace('\\', '-').replace('*', '-').replace('?', '-').replace(':', '-')
                    df = pd.DataFrame(data)
                    df.to_excel(writer, sheet_name=safe_sheet_name, index=False)
                    
                    worksheet = writer.sheets[safe_sheet_name]
                    status_col = None
                    for idx, col in enumerate(df.columns):
                        if col == 'Count Status':
                            status_col = idx + 1
                            break
                    
                    if status_col:
                        from openpyxl.styles import PatternFill
                        yellow_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
                        
                        for row_idx in range(2, len(data) + 2):
                            cell = worksheet.cell(row=row_idx, column=status_col)
                            if cell.value and 'NOT COUNTED' in str(cell.value):
                                cell.fill = yellow_fill
            else:
                df = pd.DataFrame({'Message': ['No SKU data found for the selected filters']})
                df.to_excel(writer, sheet_name='No Data', index=False)
        
        output.seek(0)
        
        filename_parts = ['inventory_export']
        if filter_date:
            filename_parts.append(filter_date)
        if filter_warehouse and filter_warehouse != 'All':
            filename_parts.append(filter_warehouse.replace(' ', '_'))
        
        filename = '_'.join(filename_parts) + f'_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Export error: {e}", file=sys.stderr)
        flash(f'Export failed: {str(e)}', 'error')
        return redirect(url_for('admin_dashboard'))

@app.route('/export_audit_log', methods=['POST'])
@login_required
def export_audit_log():
    """Export audit log data - INCLUDES session and version info for full history"""
    if current_user.role not in ['admin', 'audit']:
        flash('Access denied', 'error')
        return redirect(url_for('index'))
    
    try:
        start_date = request.form.get('start_date')
        end_date = request.form.get('end_date')
        filter_user = request.form.get('filter_user')
        
        query = AuditLog.query
        
        if start_date and start_date.strip():
            try:
                start = datetime.strptime(start_date, '%Y-%m-%d')
                query = query.filter(AuditLog.timestamp >= start)
            except ValueError:
                pass
        
        if end_date and end_date.strip():
            try:
                end = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
                query = query.filter(AuditLog.timestamp < end)
            except ValueError:
                pass
        
        if filter_user and filter_user != 'All':
            try:
                query = query.filter(AuditLog.user_id == int(filter_user))
            except ValueError:
                pass
        
        logs = query.order_by(AuditLog.timestamp.desc()).all()
        
        if not logs:
            flash('No audit log data found for the selected filters', 'warning')
            return redirect(url_for('admin_dashboard'))
        
        audit_data = []
        for log in logs:
            audit_data.append({
                'Timestamp (PHT)': log.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                'User': log.user.full_name if log.user else 'System',
                'Action': log.action,
                'Details': log.details,
                'IP Address': log.ip_address
            })
        
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df = pd.DataFrame(audit_data)
            df.to_excel(writer, sheet_name='Audit Log', index=False)
        
        output.seek(0)
        
        filename = f"audit_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        print(f"Audit export error: {e}", file=sys.stderr)
        flash(f'Audit export failed: {str(e)}', 'error')
        return redirect(url_for('admin_dashboard'))

@app.route('/audit')
@login_required
def audit_dashboard():
    if current_user.role != 'audit':
        flash('Audit access required', 'error')
        return redirect(url_for('index'))
    return render_template('audit.html')

@app.route('/get_audit_logs')
@login_required
def get_audit_logs():
    if current_user.role not in ['admin', 'audit']:
        return jsonify([])
    
    logs = AuditLog.query.order_by(AuditLog.timestamp.desc()).limit(200).all()
    return jsonify([{
        'timestamp': l.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
        'user': l.user.full_name if l.user else 'Unknown',
        'action': l.action, 'details': l.details, 'ip_address': l.ip_address
    } for l in logs])

@app.route('/api/cleanup', methods=['POST'])
@login_required
def api_cleanup():
    if current_user.role != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    days = int(request.form.get('days', 30))
    cutoff = get_ph_time() - timedelta(days=days)
    
    old_counts = CountRecord.query.filter(CountRecord.count_time < cutoff).delete()
    old_sessions = CountingSession.query.filter(CountingSession.session_date < cutoff).delete()
    old_audits = AuditLog.query.filter(AuditLog.timestamp < cutoff).delete()
    db.session.commit()
    
    return jsonify({'message': f'Deleted {old_counts} counts, {old_sessions} sessions, {old_audits} audit logs', 'success': True})

@app.route('/sync_data', methods=['POST'])
@login_required
def sync_data():
    if current_user.role != 'admin':
        return jsonify({'error': 'Unauthorized'}), 403
    
    try:
        success = sync_data_from_drive()
        
        if success:
            return jsonify({'success': True, 'message': 'Data synced successfully from Google Drive!'})
        else:
            return jsonify({'success': False, 'message': 'Sync failed. Check server logs for details.'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

# Debug endpoints (admin only)
@app.route('/debug_counts/<int:sku_id>')
@login_required
def debug_counts(sku_id):
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    session_id = request.args.get('session_id')
    if not session_id:
        return "Need session_id parameter"
    
    records = CountRecord.query.filter_by(
        session_id=session_id,
        sku_id=sku_id
    ).order_by(CountRecord.version).all()
    
    sku = SKU.query.get(sku_id)
    
    result = f"<h2>Count History for SKU: {sku.sku if sku else 'Unknown'}</h2>"
    result += "<table border='1' cellpadding='5'>"
    result += "<tr><th>Version</th><th>Count</th><th>Recount</th><th>Final</th><th>Time</th></tr>"
    
    for r in records:
        result += f"<tr>"
        result += f"日上午{r.version}</td>"
        result += f"<td>{r.initial_count}</td>"
        result += f"<td>{r.recount_count if r.recount_count else '-'}</td>"
        result += f"<td>{r.final_count if r.final_count else '-'}</td>"
        result += f"<td>{r.count_time}</td>"
        result += f"</tr>"
    
    result += "</table>"
    result += f"<p><strong>Latest count: {records[-1].initial_count if records else 'None'}</strong></p>"
    result += '<p><a href="/admin">Back to Admin</a></p>'
    
    return result

@app.route('/debug_session/<int:session_id>')
@login_required
def debug_session(session_id):
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    records = CountRecord.query.filter_by(session_id=session_id).order_by(CountRecord.sku_id, CountRecord.version).all()
    
    result = f"<h2>Session {session_id} - All Count Records</h2>"
    result += "<table border='1' cellpadding='5'>"
    result += "<tr><th>SKU</th><th>Version</th><th>Count</th><th>Time</th><th>Recount</th><th>Final</th></tr>"
    
    for r in records:
        result += f"<tr>"
        result += f"<td>{r.sku.sku if r.sku else 'Unknown'}</td>"
        result += f"日上午{r.version}</td>"
        result += f"<td>{r.initial_count}</td>"
        result += f"<td>{r.count_time}</td>"
        result += f"<td>{r.recount_count if r.recount_count else '-'}</td>"
        result += f"<td>{r.final_count if r.final_count else '-'}</td>"
        result += f"</tr>"
    
    result += "</table>"
    result += '<p><a href="/admin">Back to Admin</a></p>'
    
    return result

# Health check endpoint for Render
@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

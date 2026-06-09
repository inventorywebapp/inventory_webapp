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

# Create default admin user (moved inside app context)
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

# Call the function
create_default_users()

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
                         day_categories=[c[0] for c in day_categories if c[0]],
                         item_categories=[c[0] for c in item_categories if c[0]],
                         warehouses=warehouses)

@app.route('/get_skus')
@login_required
def get_skus():
    day_category = request.args.get('day_category')
    item_category = request.args.get('item_category')
    search = request.args.get('search', '')
    
    query = SKU.query
    
    if day_category and day_category != 'All':
        query = query.filter(SKU.category == day_category)
    if item_category and item_category != 'All':
        query = query.filter(SKU.description == item_category)
    if search:
        query = query.filter(SKU.sku.contains(search) | SKU.description.contains(search))
    
    skus = query.all()
    result = [{
        'id': s.id, 'sku': s.sku, 'description': s.description,
        'category': s.category, 'last_count_date': s.last_count_date,
        'last_count': s.last_count, 'total_container_qty': s.total_container_qty,
        'container_details': s.container_details, 'final_expected_count': s.final_expected_count,
        'kenneth_inventory': s.kenneth_inventory, 'stock_status': s.stock_status,
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
        SKU.sku.contains(search_term) | SKU.description.contains(search_term)
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
        
        session_obj = CountingSession.query.get(session_id)
        if not session_obj:
            session_obj = CountingSession(user_id=current_user.id, warehouse=data.get('warehouse'))
            db.session.add(session_obj)
            db.session.commit()
        
        for sku_id, count_data in counts.items():
            sku = SKU.query.get(int(sku_id))
            initial_count = float(count_data.get('initial_count', 0))
            
            recount_needed = False
            if not sku.bypass_recount:
                recount_needed = check_recount_needed(initial_count, sku.final_expected_count, sku.kenneth_inventory)
            
            count_record = CountRecord.query.filter_by(session_id=session_obj.id, sku_id=int(sku_id)).first()
            if not count_record:
                count_record = CountRecord(session_id=session_obj.id, sku_id=int(sku_id))
                db.session.add(count_record)
            
            count_record.initial_count = initial_count
            count_record.is_recount_needed = recount_needed
            count_record.count_time = get_ph_time()
        
        db.session.commit()
        
        audit = AuditLog(user_id=current_user.id, action='Initial Count',
                       details=f'Saved counts for session {session_obj.id}', ip_address=request.remote_addr)
        db.session.add(audit)
        db.session.commit()
        
        return jsonify({'success': True, 'session_id': session_obj.id})
    
    warehouses = ['Main Warehouse', '5th Floor Warehouse']
    day_categories = db.session.query(SKU.category).distinct().all()
    item_categories = db.session.query(SKU.description).distinct().all()
    
    return render_template('counting.html',
                         warehouses=warehouses,
                         day_categories=[c[0] for c in day_categories if c[0]],
                         item_categories=[c[0] for c in item_categories if c[0]])

@app.route('/get_recount_list')
@login_required
def get_recount_list():
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify([])
    
    records = CountRecord.query.filter_by(session_id=session_id, is_recount_needed=True, recount_completed=False).all()
    result = [{
        'id': r.id, 'sku_id': r.sku.id, 'sku': r.sku.sku, 'description': r.sku.description,
        'initial_count': r.initial_count, 'final_expected_count': r.sku.final_expected_count,
        'kenneth_inventory': r.sku.kenneth_inventory, 'remarks': r.remarks
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
            
            audit = AuditLog(user_id=current_user.id, action='Recount',
                           details=f'Completed recount for SKU {record.sku.sku}', ip_address=request.remote_addr)
            db.session.add(audit)
    
    db.session.commit()
    return jsonify({'success': True})

@app.route('/complete_counting', methods=['POST'])
@login_required
def complete_counting():
    session_id = request.json.get('session_id')
    session_obj = CountingSession.query.get(session_id)
    if session_obj:
        session_obj.is_completed = True
        db.session.commit()
        
        audit = AuditLog(user_id=current_user.id, action='Complete Counting',
                       details=f'Completed counting session {session_id}', ip_address=request.remote_addr)
        db.session.add(audit)
        db.session.commit()
        
        return jsonify({'success': True})
    return jsonify({'success': False}), 400

@app.route('/admin')
@login_required
def admin_dashboard():
    if current_user.role != 'admin':
        flash('Admin access required', 'error')
        return redirect(url_for('index'))
    
    users = User.query.all()
    sessions = CountingSession.query.order_by(CountingSession.session_date.desc()).limit(50).all()
    audit_logs = AuditLog.query.order_by(AuditLog.timestamp.desc()).limit(100).all()
    
    return render_template('admin.html', users=users, sessions=sessions, audit_logs=audit_logs)

@app.route('/export_counts', methods=['POST'])
@login_required
def export_counts():
    if current_user.role not in ['admin', 'audit']:
        flash('Access denied', 'error')
        return redirect(url_for('index'))
    
    filter_date = request.form.get('filter_date')
    query = CountingSession.query.filter_by(is_completed=True)
    
    if filter_date:
        target_date = datetime.strptime(filter_date, '%Y-%m-%d')
        query = query.filter(CountingSession.session_date >= target_date,
                            CountingSession.session_date < target_date + timedelta(days=1))
    
    sheets_data = {}
    for session_obj in query.all():
        for record in session_obj.count_records:
            sku = record.sku
            day_category = sku.category or 'Uncategorized'
            if day_category not in sheets_data:
                sheets_data[day_category] = []
            
            sheets_data[day_category].append({
                'SKU': sku.sku, 'Description': sku.description,
                'Initial Count': record.initial_count, 'Recount Count': record.recount_count,
                'Final Count': record.final_count, 'Remarks': record.remarks,
                'Date/Time Counted': record.count_time.strftime('%Y-%m-%d %H:%M:%S'),
                'Counter': session_obj.user.full_name if session_obj.user else 'Unknown',
                'Warehouse': session_obj.warehouse, 'Last Count Reference': sku.last_count,
                'Final Expected Count': sku.final_expected_count, "Kenneth's Inventory": sku.kenneth_inventory
            })
    
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        if sheets_data:
            for sheet_name, data in sheets_data.items():
                sheet_name = str(sheet_name)[:31].replace('/', '-')
                pd.DataFrame(data).to_excel(writer, sheet_name=sheet_name, index=False)
        else:
            pd.DataFrame({'Message': ['No data found']}).to_excel(writer, sheet_name='No Data', index=False)
    
    output.seek(0)
    return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                     as_attachment=True,
                     download_name=f"inventory_count_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx")

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
    """Manually sync data from Google Drive"""
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

# Test endpoint to check environment variables
@app.route('/test_env')
@login_required
def test_env():
    """Test endpoint to verify environment variables are set"""
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    creds = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    folder = os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
    
    creds_status = 'SET' if creds else 'NOT SET'
    creds_length = len(creds) if creds else 0
    
    folder_status = folder if folder else 'NOT SET'
    
    return f"""
    <html>
    <head><title>Environment Test</title></head>
    <body>
    <h2>Environment Variables Status</h2>
    <ul>
        <li><strong>GOOGLE_CREDENTIALS_JSON:</strong> {creds_status} (length: {creds_length} characters)</li>
        <li><strong>GOOGLE_DRIVE_FOLDER_ID:</strong> {folder_status}</li>
    </ul>
    <hr>
    <p><a href="/admin">Back to Admin</a></p>
    </body>
    </html>
    """

# Debug endpoint to see Excel column names
@app.route('/debug_columns')
@login_required
def debug_columns():
    """Debug: Show Excel column names and sample data"""
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    try:
        import json
        import io
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaIoBaseDownload
        
        # Get credentials
        creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
        creds_dict = json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict, 
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        
        # Build Drive service
        drive_service = build('drive', 'v3', credentials=credentials)
        
        # Get folder ID
        folder_id = os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
        
        # Find Excel files
        results = drive_service.files().list(
            q=f"'{folder_id}' in parents and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
            fields="files(id, name)",
            orderBy="createdTime desc"
        ).execute()
        
        files = results.get('files', [])
        if not files:
            return "No Excel files found"
        
        # Download the file
        file_id = files[0]['id']
        request = drive_service.files().get_media(fileId=file_id)
        file_stream = io.BytesIO()
        downloader = MediaIoBaseDownload(file_stream, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        
        file_stream.seek(0)
        df = pd.read_excel(file_stream)
        
        # Get column names
        columns = list(df.columns)
        
        # Get first 3 rows as sample
        sample = df.head(3).to_dict('records')
        
        result = f"""
        <html>
        <head><title>Excel Debug Info</title></head>
        <body>
        <h2>Excel File: {files[0]['name']}</h2>
        
        <h3>Column Names ({len(columns)} columns):</h3>
        <ul>
        """
        for col in columns:
            result += f"<li><strong>'{col}'</strong></li>"
        
        result += "</ul>"
        
        result += "<h3>First 3 Rows (Sample Data):</h3>"
        result += '<table border="1" cellpadding="5">'
        result += "服务"
        for col in columns[:10]:  # Show first 10 columns
            result += f"<th>{col}</th>"
        result += "</tr>"
        
        for row in sample:
            result += "服务"
            for col in columns[:10]:
                val = row.get(col, '')
                if pd.isna(val):
                    val = 'NULL'
                result += f"<td>{str(val)[:50]}</td>"
            result += "</tr>"
        
        result += """
        </table>
        <p><a href="/admin">Back to Admin</a></p>
        </body>
        </html>
        """
        
        return result
        
    except Exception as e:
        return f"Error: {str(e)}"

@app.route('/check_db_categories')
@login_required
def check_db_categories():
    """Check what categories are in the database"""
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    day_cats = db.session.query(SKU.category).distinct().all()
    item_cats = db.session.query(SKU.description).distinct().all()
    total = SKU.query.count()
    
    result = f"""
    <html>
    <head><title>Database Categories</title></head>
    <body>
    <h2>Database Statistics</h2>
    <p>Total SKUs: {total}</p>
    
    <h3>Day Categories (from Category column):</h3>
    <ul>
    """
    for cat in day_cats:
        if cat[0]:
            result += f"<li>'{cat[0]}'</li>"
        else:
            result += f"<li>NULL/Empty</li>"
    
    result += "</ul>"
    
    result += "<h3>Item Categories (from Description column):</h3>"
    result += "<ul>"
    for cat in item_cats[:50]:  # Show first 50
        if cat[0]:
            result += f"<li>'{cat[0]}'</li>"
    
    result += """
    </ul>
    <p><a href="/admin">Back to Admin</a></p>
    </body>
    </html>
    """
    
    return result

@app.route('/check_data')
@login_required
def check_data():
    """Simple check of database contents"""
    if current_user.role != 'admin':
        return "Unauthorized", 403
    
    total = SKU.query.count()
    sample = SKU.query.limit(10).all()
    
    result = f"""
    <html>
    <head><title>Database Data Check</title></head>
    <body>
    <h2>Database Check</h2>
    <p>Total SKUs in database: <strong>{total}</strong></p>
    """
    
    if total > 0:
        result += "<h3>Sample SKUs (first 10):</h3>"
        result += '<table border="1" cellpadding="5">'
        result += '<tr><th>SKU</th><th>Description (Item Category)</th><th>Category (Day Category)</th><th>Last Count</th><th>Final Expected</th></tr>'
        for sku in sample:
            result += f"""
            <tr>
                <td><strong>{sku.sku}</strong></td>
                <td>{sku.description or 'EMPTY'}</td>
                <td>{sku.category or 'EMPTY'}</td>
                <td>{sku.last_count}</td>
                <td>{sku.final_expected_count}</td>
            </tr>
            """
        result += "</table>"
    else:
        result += "<p style='color:red'>No SKUs found! You need to run sync first.</p>"
        result += '<button onclick="runSync()">Run Sync Now</button>'
        result += '''
        <script>
        function runSync() {
            fetch('/sync_data', {method: 'POST'})
                .then(r => r.json())
                .then(d => {
                    alert(d.message || d.error);
                    if (d.success) location.reload();
                })
                .catch(e => alert('Error: ' + e));
        }
        </script>
        '''
    
    result += '<p><a href="/admin">Back to Admin</a> | <a href="/sync_data" onclick="sync(); return false;">Run Sync</a></p>'
    result += '<script>function sync(){fetch("/sync_data",{method:"POST"}).then(r=>r.json()).then(d=>alert(d.message||d.error)).catch(e=>alert("Error: "+e))}</script>'
    result += '</body></html>'
    
    return result

# Health check endpoint for Render
@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

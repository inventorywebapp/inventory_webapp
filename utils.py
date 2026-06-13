import re
import os
import json
import io
import sys
from datetime import datetime
import pytz
import pandas as pd
from models import db, SKU, AuditLog
from flask_login import current_user

# Google API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

def get_ph_time():
    """Get current Philippines time"""
    ph_tz = pytz.timezone('Asia/Manila')
    return datetime.now(ph_tz)

def check_recount_needed(initial_count, expected_count, kenneth_count):
    """
    Check if recount is needed based on discrepancy > 3 or < -3
    NEGATIVE VALUES in expected_count or kenneth_count are TREATED AS 0
    """
    if initial_count is None:
        return False
    
    try:
        initial = float(initial_count)
        
        # CRITICAL FIX: Treat negative values as 0
        # If expected_count is negative, None, or invalid, use 0
        if expected_count is not None:
            try:
                exp_val = float(expected_count)
                expected = exp_val if exp_val > 0 else 0
            except (ValueError, TypeError):
                expected = 0
        else:
            expected = 0
        
        # If kenneth_count is negative, None, or invalid, use 0
        if kenneth_count is not None:
            try:
                ken_val = float(kenneth_count)
                kenneth = ken_val if ken_val > 0 else 0
            except (ValueError, TypeError):
                kenneth = 0
        else:
            kenneth = 0
        
    except (ValueError, TypeError):
        return False
    
    # Compare with Final Expected Count (which is now 0 if negative)
    diff_expected = abs(initial - expected)
    
    # Compare with Kenneth's Inventory (which is now 0 if negative)
    diff_kenneth = abs(initial - kenneth)
    
    # If either difference is greater than 3, recount needed
    if diff_expected > 3 or diff_kenneth > 3:
        return True
    
    return False

def parse_container_details(container_details_str):
    """Parse container details string like '30 (5/20/26), 35 (5/22/26)'"""
    if not container_details_str:
        return []
    
    pattern = r'(\d+)\s*\(([^)]+)\)'
    matches = re.findall(pattern, container_details_str)
    return [{'qty': int(qty), 'date': date} for qty, date in matches]

def detect_column_mapping(df):
    """
    Automatically detect column mapping based on available columns
    Returns a dictionary mapping standard fields to Excel column names
    """
    # Get all column names as strings
    columns = [str(col).strip() for col in df.columns]
    
    # Define possible column name variations
    column_patterns = {
        'sku': ['SKU', 'Sku', 'sku', 'Item Code', 'Product Code', 'Code', 'Item_Code', 'Product_ID', 'ID'],
        'description': ['Description', 'description', 'Item Category', 'Item', 'Product Name', 'DESCRIPTION', 'Item_Name', 'Product', 'Name'],
        'category': ['Category', 'category', 'Day Category', 'Day', 'Type', 'CATEGORY', 'Day_Category', 'Product_Type'],
        'last_count_date': ['LastCountDate', 'Last Count Date', 'last_count_date', 'Previous Count Date', 'Last Counted'],
        'last_count': ['LastCount', 'Last Count', 'last_count', 'Previous Count', 'Previous Quantity'],
        'total_container_qty': ['TotalContainerQty', 'Total Container Qty', 'Container Qty', 'Container Quantity'],
        'container_details': ['ContainerDetails', 'Container Details', 'Container Info', 'Details'],
        'total_orders': ['TotalOrders', 'Total Orders', 'Orders', 'Order Count'],
        'final_expected_count': ['Final Expected Count', 'Expected Count', 'Final Count', 'Expected', 'Target Count'],
        'kenneth_inventory': ["Kenneth's Inventory", 'Kenneth Inventory', 'Kenneth Count', 'Physical Count'],
        'buffer_qty': ['BufferQty', 'Buffer Qty', 'Buffer', 'Safety Stock'],
        'stock_status': ['StockStatus', 'Stock Status', 'Status', 'Stock Level'],
        'inventory_remark': ['InventoryRemark', 'Inventory Remark', 'Remark', 'Notes', 'Comments'],
        'sku_status': ['SKUStatus', 'SKU Status', 'Active Status', 'Status']
    }
    
    mapping = {}
    for field, patterns in column_patterns.items():
        for pattern in patterns:
            # Try exact match first
            if pattern in columns:
                mapping[field] = pattern
                break
            # Try case-insensitive match
            for col in columns:
                if col.lower() == pattern.lower():
                    mapping[field] = col
                    break
            if field in mapping:
                break
    
    # Debug output
    print(f"Detected column mapping: {mapping}", file=sys.stderr)
    
    return mapping

def sync_data_from_drive():
    """Sync data from Google Drive - Hybrid approach: Update/Add new, Mark inactive for removed"""
    try:
        print("=== STARTING SYNC PROCESS (Hybrid Mode) ===", file=sys.stderr)
        
        # Get credentials from environment variable
        creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
        if not creds_json:
            print("ERROR: GOOGLE_CREDENTIALS_JSON not found", file=sys.stderr)
            return False
        
        print(f"Credentials found, length: {len(creds_json)}", file=sys.stderr)
        
        # Parse credentials
        creds_dict = json.loads(creds_json)
        print("JSON parsed successfully", file=sys.stderr)
        
        # Create credentials object
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict, 
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        print("Credentials created", file=sys.stderr)
        
        # Build Drive service
        drive_service = build('drive', 'v3', credentials=credentials)
        print("Drive service built", file=sys.stderr)
        
        # Get folder ID
        folder_id = os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
        if not folder_id:
            print("ERROR: GOOGLE_DRIVE_FOLDER_ID not found", file=sys.stderr)
            return False
        
        print(f"Folder ID: {folder_id}", file=sys.stderr)
        
        # Search for Excel files
        print("Searching for Excel files...", file=sys.stderr)
        results = drive_service.files().list(
            q=f"'{folder_id}' in parents and (mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.ms-excel')",
            fields="files(id, name, createdTime)",
            orderBy="createdTime desc"
        ).execute()
        
        files = results.get('files', [])
        print(f"Found {len(files)} Excel files", file=sys.stderr)
        
        if not files:
            print("No Excel files found in folder", file=sys.stderr)
            return False
        
        # Get newest file
        latest_file = files[0]
        file_id = latest_file['id']
        file_name = latest_file['name']
        print(f"Latest file: {file_name}", file=sys.stderr)
        
        # Download file
        print("Downloading file...", file=sys.stderr)
        request = drive_service.files().get_media(fileId=file_id)
        file_stream = io.BytesIO()
        downloader = MediaIoBaseDownload(file_stream, request)
        done = False
        while not done:
            status, done = downloader.next_chunk()
            if status:
                print(f"Download progress: {int(status.progress() * 100)}%", file=sys.stderr)
        
        file_stream.seek(0)
        print("Download complete", file=sys.stderr)
        
        # Read Excel - try different engines if needed
        print("Reading Excel file...", file=sys.stderr)
        try:
            df = pd.read_excel(file_stream, engine='openpyxl')
        except:
            file_stream.seek(0)
            df = pd.read_excel(file_stream, engine='xlrd')
        
        total_rows = len(df)
        
        # Print column names for debugging
        print(f"Excel columns found: {list(df.columns)}", file=sys.stderr)
        
        # Auto-detect column mapping
        column_mapping = detect_column_mapping(df)
        
        # Check if we found required columns
        if 'sku' not in column_mapping:
            print("ERROR: Could not find SKU column", file=sys.stderr)
            print(f"Available columns: {list(df.columns)}", file=sys.stderr)
            print("Please ensure your Excel has a column named: SKU, Item Code, Product Code, or Code", file=sys.stderr)
            return False
        
        print(f"Using column mapping: {column_mapping}", file=sys.stderr)
        
        # Track SKUs found in Excel
        skus_found_in_excel = set()
        
        # Track statistics
        skus_updated = 0
        skus_added = 0
        skus_reactivated = 0
        errors = []
        
        # Process each row - UPDATE existing or ADD new
        for index, row in df.iterrows():
            try:
                # Get SKU value
                sku_value = str(row[column_mapping['sku']]) if pd.notna(row[column_mapping['sku']]) else ''
                
                if not sku_value or sku_value == 'nan':
                    print(f"Warning: Empty SKU at row {index}, skipping", file=sys.stderr)
                    continue
                
                # Add to found set
                skus_found_in_excel.add(sku_value)
                
                # Check if SKU exists
                existing_sku = SKU.query.filter_by(sku=sku_value).first()
                
                if existing_sku:
                    # Update existing SKU
                    sku = existing_sku
                    if not sku.is_active:
                        sku.is_active = True
                        skus_reactivated += 1
                        print(f"Reactivated SKU: {sku_value}", file=sys.stderr)
                    skus_updated += 1
                else:
                    # Create new SKU
                    sku = SKU()
                    sku.is_active = True
                    skus_added += 1
                    print(f"Adding new SKU: {sku_value}", file=sys.stderr)
                
                # Update SKU fields based on detected mapping
                sku.sku = sku_value
                
                # Description
                if 'description' in column_mapping:
                    sku.description = str(row[column_mapping['description']]) if pd.notna(row[column_mapping['description']]) else ''
                
                # Category (Day Category)
                if 'category' in column_mapping:
                    sku.category = str(row[column_mapping['category']]) if pd.notna(row[column_mapping['category']]) else ''
                
                # Numeric fields - handle carefully
                if 'last_count' in column_mapping:
                    try:
                        sku.last_count = float(row[column_mapping['last_count']]) if pd.notna(row[column_mapping['last_count']]) else 0
                    except:
                        sku.last_count = 0
                
                if 'total_container_qty' in column_mapping:
                    try:
                        sku.total_container_qty = float(row[column_mapping['total_container_qty']]) if pd.notna(row[column_mapping['total_container_qty']]) else 0
                    except:
                        sku.total_container_qty = 0
                
                if 'total_orders' in column_mapping:
                    try:
                        sku.total_orders = float(row[column_mapping['total_orders']]) if pd.notna(row[column_mapping['total_orders']]) else 0
                    except:
                        sku.total_orders = 0
                
                if 'final_expected_count' in column_mapping:
                    try:
                        sku.final_expected_count = float(row[column_mapping['final_expected_count']]) if pd.notna(row[column_mapping['final_expected_count']]) else 0
                    except:
                        sku.final_expected_count = 0
                
                if 'kenneth_inventory' in column_mapping:
                    try:
                        sku.kenneth_inventory = float(row[column_mapping['kenneth_inventory']]) if pd.notna(row[column_mapping['kenneth_inventory']]) else 0
                    except:
                        sku.kenneth_inventory = 0
                
                if 'buffer_qty' in column_mapping:
                    try:
                        sku.buffer_qty = float(row[column_mapping['buffer_qty']]) if pd.notna(row[column_mapping['buffer_qty']]) else 0
                    except:
                        sku.buffer_qty = 0
                
                # Text fields
                if 'last_count_date' in column_mapping:
                    sku.last_count_date = str(row[column_mapping['last_count_date']]) if pd.notna(row[column_mapping['last_count_date']]) else ''
                
                if 'container_details' in column_mapping:
                    sku.container_details = str(row[column_mapping['container_details']]) if pd.notna(row[column_mapping['container_details']]) else ''
                
                if 'stock_status' in column_mapping:
                    sku.stock_status = str(row[column_mapping['stock_status']]) if pd.notna(row[column_mapping['stock_status']]) else ''
                
                if 'inventory_remark' in column_mapping:
                    sku.inventory_remark = str(row[column_mapping['inventory_remark']]) if pd.notna(row[column_mapping['inventory_remark']]) else ''
                
                if 'sku_status' in column_mapping:
                    sku.sku_status = str(row[column_mapping['sku_status']]) if pd.notna(row[column_mapping['sku_status']]) else ''
                
                # Set bypass recount for specific Item Categories
                if sku.description in ['Console/Armrest', 'Armrest', 'Wiper', 'Armrest category', 'Wiper category']:
                    sku.bypass_recount = True
                
                # Update timestamp
                sku.updated_at = get_ph_time()
                
                # Add to session (will be committed in batches)
                db.session.add(sku)
                
                # Commit every 500 rows to avoid memory issues
                if (skus_updated + skus_added + skus_reactivated) % 500 == 0:
                    db.session.commit()
                    print(f"Progress: {skus_added} new, {skus_updated} updated, {skus_reactivated} reactivated so far", file=sys.stderr)
                
            except Exception as row_error:
                error_msg = f"Error processing row {index}: {row_error}"
                print(error_msg, file=sys.stderr)
                errors.append(error_msg)
                continue
        
        # MARK INACTIVE: SKUs in database but NOT in Excel
        print("Checking for SKUs to mark as inactive...", file=sys.stderr)
        all_db_skus = SKU.query.filter_by(is_active=True).all()
        skus_marked_inactive = 0
        inactive_sku_list = []
        
        for db_sku in all_db_skus:
            if db_sku.sku not in skus_found_in_excel:
                db_sku.is_active = False
                skus_marked_inactive += 1
                inactive_sku_list.append(db_sku.sku)
                print(f"Marked as inactive (removed from Excel): {db_sku.sku}", file=sys.stderr)
        
        # Final commit
        db.session.commit()
        
        # Log the sync action
        try:
            from flask import has_request_context
            if has_request_context():
                from flask_login import current_user
                if current_user and current_user.is_authenticated:
                    audit_details = f"Synced from {file_name}: +{skus_added} new, ~{skus_updated} updated, -{skus_marked_inactive} inactive, 🔄{skus_reactivated} reactivated"
                    if errors:
                        audit_details += f", {len(errors)} errors"
                    
                    audit = AuditLog(
                        user_id=current_user.id,
                        action='Google Drive Sync',
                        details=audit_details,
                        ip_address='SYSTEM'
                    )
                    db.session.add(audit)
                    db.session.commit()
        except:
            pass
        
        print(f"=== SYNC COMPLETE (Hybrid Mode) ===", file=sys.stderr)
        print(f"New SKUs added: {skus_added}", file=sys.stderr)
        print(f"Existing SKUs updated: {skus_updated}", file=sys.stderr)
        print(f"SKUs reactivated: {skus_reactivated}", file=sys.stderr)
        print(f"SKUs marked inactive (removed from Excel): {skus_marked_inactive}", file=sys.stderr)
        print(f"Total ACTIVE SKUs in database: {SKU.query.filter_by(is_active=True).count()}", file=sys.stderr)
        print(f"Total ALL SKUs (including inactive): {SKU.query.count()}", file=sys.stderr)
        
        if errors:
            print(f"Errors encountered: {len(errors)}", file=sys.stderr)
        
        return True
        
    except Exception as e:
        print(f"=== SYNC FAILED: {str(e)} ===", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

def import_excel_data(file_path):
    """Import data from Excel file to database - PRESERVES existing data"""
    try:
        df = pd.read_excel(file_path)
        
        # Auto-detect column mapping
        column_mapping = detect_column_mapping(df)
        
        if 'sku' not in column_mapping:
            print("ERROR: Could not find SKU column", file=sys.stderr)
            return False
        
        # Track SKUs found in Excel
        skus_found_in_excel = set()
        skus_updated = 0
        skus_added = 0
        skus_reactivated = 0
        
        for _, row in df.iterrows():
            sku_value = str(row[column_mapping.get('sku')]) if pd.notna(row[column_mapping.get('sku')]) else ''
            
            if not sku_value:
                continue
            
            skus_found_in_excel.add(sku_value)
            
            # Check if SKU exists
            sku = SKU.query.filter_by(sku=sku_value).first()
            if not sku:
                sku = SKU()
                sku.is_active = True
                skus_added += 1
            else:
                if not sku.is_active:
                    sku.is_active = True
                    skus_reactivated += 1
                skus_updated += 1
            
            # Update fields
            sku.sku = sku_value
            
            if 'description' in column_mapping:
                sku.description = str(row[column_mapping['description']]) if pd.notna(row[column_mapping['description']]) else ''
            
            if 'category' in column_mapping:
                sku.category = str(row[column_mapping['category']]) if pd.notna(row[column_mapping['category']]) else ''
            
            if 'last_count_date' in column_mapping:
                sku.last_count_date = str(row[column_mapping['last_count_date']]) if pd.notna(row[column_mapping['last_count_date']]) else ''
            
            if 'last_count' in column_mapping:
                try:
                    sku.last_count = float(row[column_mapping['last_count']]) if pd.notna(row[column_mapping['last_count']]) else 0
                except:
                    sku.last_count = 0
            
            if 'total_container_qty' in column_mapping:
                try:
                    sku.total_container_qty = float(row[column_mapping['total_container_qty']]) if pd.notna(row[column_mapping['total_container_qty']]) else 0
                except:
                    sku.total_container_qty = 0
            
            if 'container_details' in column_mapping:
                sku.container_details = str(row[column_mapping['container_details']]) if pd.notna(row[column_mapping['container_details']]) else ''
            
            if 'total_orders' in column_mapping:
                try:
                    sku.total_orders = float(row[column_mapping['total_orders']]) if pd.notna(row[column_mapping['total_orders']]) else 0
                except:
                    sku.total_orders = 0
            
            if 'final_expected_count' in column_mapping:
                try:
                    sku.final_expected_count = float(row[column_mapping['final_expected_count']]) if pd.notna(row[column_mapping['final_expected_count']]) else 0
                except:
                    sku.final_expected_count = 0
            
            if 'kenneth_inventory' in column_mapping:
                try:
                    sku.kenneth_inventory = float(row[column_mapping['kenneth_inventory']]) if pd.notna(row[column_mapping['kenneth_inventory']]) else 0
                except:
                    sku.kenneth_inventory = 0
            
            if 'buffer_qty' in column_mapping:
                try:
                    sku.buffer_qty = float(row[column_mapping['buffer_qty']]) if pd.notna(row[column_mapping['buffer_qty']]) else 0
                except:
                    sku.buffer_qty = 0
            
            if 'stock_status' in column_mapping:
                sku.stock_status = str(row[column_mapping['stock_status']]) if pd.notna(row[column_mapping['stock_status']]) else ''
            
            if 'inventory_remark' in column_mapping:
                sku.inventory_remark = str(row[column_mapping['inventory_remark']]) if pd.notna(row[column_mapping['inventory_remark']]) else ''
            
            if 'sku_status' in column_mapping:
                sku.sku_status = str(row[column_mapping['sku_status']]) if pd.notna(row[column_mapping['sku_status']]) else ''
            
            # Set bypass recount for specific Item Categories
            if sku.description in ['Console/Armrest', 'Armrest', 'Wiper', 'Armrest category', 'Wiper category']:
                sku.bypass_recount = True
            
            sku.updated_at = get_ph_time()
            
            db.session.add(sku)
        
        # Mark inactive SKUs
        all_db_skus = SKU.query.filter_by(is_active=True).all()
        skus_marked_inactive = 0
        
        for db_sku in all_db_skus:
            if db_sku.sku not in skus_found_in_excel:
                db_sku.is_active = False
                skus_marked_inactive += 1
        
        db.session.commit()
        print(f"Import complete: +{skus_added} new, ~{skus_updated} updated, -{skus_marked_inactive} inactive, 🔄{skus_reactivated} reactivated", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"Error importing data: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

def get_sync_status():
    """Get information about the current sync state"""
    try:
        total_active_skus = SKU.query.filter_by(is_active=True).count()
        total_all_skus = SKU.query.count()
        last_updated = db.session.query(db.func.max(SKU.updated_at)).scalar()
        
        return {
            'active_skus': total_active_skus,
            'inactive_skus': total_all_skus - total_active_skus,
            'total_skus': total_all_skus,
            'last_sync': last_updated.strftime('%Y-%m-%d %H:%M:%S') if last_updated else 'Never',
            'status': 'ok'
        }
    except:
        return {'active_skus': 0, 'inactive_skus': 0, 'total_skus': 0, 'last_sync': 'Never', 'status': 'error'}

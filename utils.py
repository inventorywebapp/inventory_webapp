import re
import os
import json
import io
import sys
from datetime import datetime
import pytz
import pandas as pd
from models import db, SKU

# Google API imports
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

def get_ph_time():
    """Get current Philippines time"""
    ph_tz = pytz.timezone('Asia/Manila')
    return datetime.now(ph_tz)

def check_recount_needed(initial_count, expected_count, kenneth_count):
    """Check if recount is needed based on discrepancy > 3 or < -3"""
    if initial_count is None:
        return False
    
    try:
        initial = float(initial_count)
        expected = float(expected_count) if expected_count else 0
        kenneth = float(kenneth_count) if kenneth_count else 0
    except (ValueError, TypeError):
        return False
    
    diff_expected = abs(initial - expected) if expected else 0
    diff_kenneth = abs(initial - kenneth) if kenneth else 0
    
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

def sync_data_from_drive():
    """Sync data from Google Drive using service account - OPTIMIZED VERSION"""
    try:
        print("=== STARTING SYNC PROCESS ===", file=sys.stderr)
        
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
            q=f"'{folder_id}' in parents and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
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
        
        # Read Excel
        print("Reading Excel file...", file=sys.stderr)
        df = pd.read_excel(file_stream)
        total_rows = len(df)
        print(f"Excel has {total_rows} rows and {len(df.columns)} columns", file=sys.stderr)
        
        # OPTIMIZATION: Get all existing SKUs once
        print("Loading existing SKUs...", file=sys.stderr)
        existing_skus = {sku.sku: sku for sku in SKU.query.all()}
        print(f"Found {len(existing_skus)} existing SKUs", file=sys.stderr)
        
        # Process rows
        count_new = 0
        count_updated = 0
        batch_size = 500
        
        for index, row in df.iterrows():
            sku_code = str(row['SKU'])
            
            # Check if SKU exists
            if sku_code in existing_skus:
                sku = existing_skus[sku_code]
                count_updated += 1
            else:
                sku = SKU()
                existing_skus[sku_code] = sku
                count_new += 1
            
            # Update SKU fields
            sku.sku = sku_code
            sku.description = str(row.get('Description', '')) if pd.notna(row.get('Description')) else ''
            sku.category = str(row.get('Category', '')) if pd.notna(row.get('Category')) else ''
            sku.last_count_date = str(row.get('LastCountDate', '')) if pd.notna(row.get('LastCountDate')) else ''
            sku.last_count = float(row.get('LastCount', 0)) if pd.notna(row.get('LastCount')) else 0
            sku.total_container_qty = float(row.get('TotalContainerQty', 0)) if pd.notna(row.get('TotalContainerQty')) else 0
            sku.container_details = str(row.get('ContainerDetails', '')) if pd.notna(row.get('ContainerDetails')) else ''
            sku.total_orders = float(row.get('TotalOrders', 0)) if pd.notna(row.get('TotalOrders')) else 0
            sku.final_expected_count = float(row.get('Final Expected Count', 0)) if pd.notna(row.get('Final Expected Count')) else 0
            sku.kenneth_inventory = float(row.get("Kenneth's Inventory", 0)) if pd.notna(row.get("Kenneth's Inventory")) else 0
            sku.buffer_qty = float(row.get('BufferQty', 0)) if pd.notna(row.get('BufferQty')) else 0
            sku.stock_status = str(row.get('StockStatus', '')) if pd.notna(row.get('StockStatus')) else ''
            sku.inventory_remark = str(row.get('InventoryRemark', '')) if pd.notna(row.get('InventoryRemark')) else ''
            sku.sku_status = str(row.get('SKUStatus', '')) if pd.notna(row.get('SKUStatus')) else ''
            
            # Set bypass recount for specific categories
            if sku.description in ['Armrest', 'Wiper', 'Armrest category', 'Wiper category']:
                sku.bypass_recount = True
            
            db.session.add(sku)
            
            # Commit in batches to avoid memory issues
            if (index + 1) % batch_size == 0:
                db.session.commit()
                print(f"Committed {index + 1}/{total_rows} rows ({count_new} new, {count_updated} updated)", file=sys.stderr)
        
        # Final commit
        db.session.commit()
        print(f"=== SYNC COMPLETE: {count_new} new SKUs, {count_updated} updated SKUs ===", file=sys.stderr)
        return True
        
    except Exception as e:
        print(f"=== SYNC FAILED: {str(e)} ===", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

def import_excel_data(file_path):
    """Import data from Excel file to database"""
    try:
        df = pd.read_excel(file_path)
        
        for _, row in df.iterrows():
            sku = SKU.query.filter_by(sku=str(row['SKU'])).first()
            if not sku:
                sku = SKU()
            
            sku.sku = str(row['SKU'])
            sku.description = str(row.get('Description', ''))
            sku.category = str(row.get('Category', ''))
            sku.last_count_date = str(row.get('LastCountDate', ''))
            sku.last_count = float(row.get('LastCount', 0)) if pd.notna(row.get('LastCount')) else 0
            sku.total_container_qty = float(row.get('TotalContainerQty', 0)) if pd.notna(row.get('TotalContainerQty')) else 0
            sku.container_details = str(row.get('ContainerDetails', ''))
            sku.total_orders = float(row.get('TotalOrders', 0)) if pd.notna(row.get('TotalOrders')) else 0
            sku.final_expected_count = float(row.get('Final Expected Count', 0)) if pd.notna(row.get('Final Expected Count')) else 0
            sku.kenneth_inventory = float(row.get("Kenneth's Inventory", 0)) if pd.notna(row.get("Kenneth's Inventory")) else 0
            sku.buffer_qty = float(row.get('BufferQty', 0)) if pd.notna(row.get('BufferQty')) else 0
            sku.stock_status = str(row.get('StockStatus', ''))
            sku.inventory_remark = str(row.get('InventoryRemark', ''))
            sku.sku_status = str(row.get('SKUStatus', ''))
            
            if sku.description in ['Armrest', 'Wiper', 'Armrest category', 'Wiper category']:
                sku.bypass_recount = True
            
            db.session.add(sku)
        
        db.session.commit()
        return True
    except Exception as e:
        print(f"Error importing data: {e}")
        return False

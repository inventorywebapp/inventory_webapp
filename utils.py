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
    """
    Check if recount is needed based on discrepancy > 3 or < -3
    Negative values in expected_count or kenneth_count are treated as 0
    """
    if initial_count is None:
        return False
    
    try:
        initial = float(initial_count)
        
        # Treat negative values as 0
        expected = float(expected_count) if expected_count and float(expected_count) > 0 else 0
        kenneth = float(kenneth_count) if kenneth_count and float(kenneth_count) > 0 else 0
        
    except (ValueError, TypeError):
        return False
    
    # Compare with Final Expected Count
    diff_expected = abs(initial - expected) if expected else 0
    
    # Compare with Kenneth's Inventory
    diff_kenneth = abs(initial - kenneth) if kenneth else 0
    
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

def sync_data_from_drive():
    """Sync data from Google Drive using service account - with flexible column mapping"""
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
        
        # Print column names for debugging
        print(f"Excel columns: {list(df.columns)}", file=sys.stderr)
        
        # Flexible column mapping - try different possible column names
        # For SKU column
        sku_col = None
        for col in ['SKU', 'Sku', 'sku', 'Item Code', 'Product Code', 'Code']:
            if col in df.columns:
                sku_col = col
                break
        
        # For Description/Item Category column
        desc_col = None
        for col in ['Description', 'description', 'Item Category', 'Item', 'Product Name', 'DESCRIPTION']:
            if col in df.columns:
                desc_col = col
                break
        
        # For Category/Day Category column
        cat_col = None
        for col in ['Category', 'category', 'Day Category', 'Day', 'Type', 'CATEGORY']:
            if col in df.columns:
                cat_col = col
                break
        
        print(f"Mapped columns - SKU: {sku_col}, Description: {desc_col}, Category: {cat_col}", file=sys.stderr)
        
        if not sku_col:
            print("ERROR: Could not find SKU column", file=sys.stderr)
            print(f"Available columns: {list(df.columns)}", file=sys.stderr)
            return False
        
        total_rows = len(df)
        print(f"Excel has {total_rows} rows", file=sys.stderr)
        
        # Clear existing SKUs to avoid duplicates
        print("Clearing existing SKUs...", file=sys.stderr)
        SKU.query.delete()
        db.session.commit()
        print("Existing SKUs cleared", file=sys.stderr)
        
        # Process rows and add to database
        count = 0
        batch_size = 500
        
        for index, row in df.iterrows():
            try:
                sku = SKU()
                
                # Required field - SKU
                sku.sku = str(row[sku_col]) if pd.notna(row[sku_col]) else ''
                
                # Description (Item Category)
                sku.description = str(row.get(desc_col, '')) if desc_col and pd.notna(row.get(desc_col)) else ''
                
                # Category (Day Category) - This is what you filter by
                sku.category = str(row.get(cat_col, '')) if cat_col and pd.notna(row.get(cat_col)) else ''
                
                # Other fields
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
                
                # Set bypass recount for specific Item Categories
                if sku.description in ['Console/Armrest', 'Armrest', 'Wiper', 'Armrest category', 'Wiper category']:
                    sku.bypass_recount = True
                
                db.session.add(sku)
                count += 1
                
                # Commit in batches
                if count % batch_size == 0:
                    db.session.commit()
                    print(f"Committed {count}/{total_rows} rows", file=sys.stderr)
                    
            except Exception as row_error:
                print(f"Error processing row {index}: {row_error}", file=sys.stderr)
                continue
        
        # Final commit
        db.session.commit()
        print(f"=== SYNC COMPLETE: {count} SKUs imported ===", file=sys.stderr)
        
        # Verify data was saved
        db_count = SKU.query.count()
        print(f"Verified: {db_count} SKUs in database", file=sys.stderr)
        
        return True
        
    except Exception as e:
        print(f"=== SYNC FAILED: {str(e)} ===", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

def import_excel_data(file_path

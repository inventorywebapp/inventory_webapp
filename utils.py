import re
from datetime import datetime
import pytz
from models import db, SKU


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


def import_excel_data(file_path):
    """Import data from Excel file to database"""
    try:
        import pandas as pd
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
            sku.total_container_qty = float(row.get('TotalContainerQty', 0)) if pd.notna(
                row.get('TotalContainerQty')) else 0
            sku.container_details = str(row.get('ContainerDetails', ''))
            sku.total_orders = float(row.get('TotalOrders', 0)) if pd.notna(row.get('TotalOrders')) else 0
            sku.final_expected_count = float(row.get('Final Expected Count', 0)) if pd.notna(
                row.get('Final Expected Count')) else 0
            sku.kenneth_inventory = float(row.get("Kenneth's Inventory", 0)) if pd.notna(
                row.get("Kenneth's Inventory")) else 0
            sku.buffer_qty = float(row.get('BufferQty', 0)) if pd.notna(row.get('BufferQty')) else 0
            sku.stock_status = str(row.get('StockStatus', ''))
            sku.inventory_remark = str(row.get('InventoryRemark', ''))
            sku.sku_status = str(row.get('SKUStatus', ''))

            # Set bypass recount for specific categories
            bypass_categories = ['Armrest', 'Wiper', 'Armrest category', 'Wiper category']
            if sku.description in bypass_categories:
                sku.bypass_recount = True

            db.session.add(sku)

        db.session.commit()
        return True
    except Exception as e:
        print(f"Error importing data: {e}")
        return False


def sync_data_from_drive():
    """Sync data from Google Drive - placeholder for future implementation"""
    return False
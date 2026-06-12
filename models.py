from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
import pytz

db = SQLAlchemy()


def get_ph_time():
    """Get current Philippines time"""
    ph_tz = pytz.timezone('Asia/Manila')
    return datetime.now(ph_tz)


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    full_name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(25), nullable=False, default='inventory_staff')
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=get_ph_time)
    
    def has_permission(self, permission):
        """Check if user has specific permission"""
        if self.role == 'admin':
            return True
        permissions = {
            'manager': ['count', 'recount', 'export_counts', 'export_audit', 'view_dashboard'],
            'inventory_supervisor': ['count', 'recount', 'export_counts', 'export_audit', 'view_dashboard'],
            'inventory_staff': ['count', 'recount', 'view_dashboard'],
            'auditor': ['export_counts', 'export_audit']
        }
        return permission in permissions.get(self.role, [])
    
    def get_role_display(self):
        """Get display name for user role"""
        role_names = {
            'admin': 'Admin',
            'manager': 'Manager',
            'inventory_supervisor': 'Inventory Supervisor',
            'inventory_staff': 'Inventory Staff',
            'auditor': 'Auditor'
        }
        return role_names.get(self.role, self.role.replace('_', ' ').title())


class SKU(db.Model):
    __tablename__ = 'skus'
    id = db.Column(db.Integer, primary_key=True)
    sku = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.String(200))
    category = db.Column(db.String(50))
    last_count_date = db.Column(db.String(20))
    last_count = db.Column(db.Float, default=0)
    total_container_qty = db.Column(db.Float, default=0)
    container_details = db.Column(db.Text)
    total_orders = db.Column(db.Float, default=0)
    final_expected_count = db.Column(db.Float, default=0)
    kenneth_inventory = db.Column(db.Float, default=0)
    buffer_qty = db.Column(db.Float, default=0)
    stock_status = db.Column(db.String(50))
    inventory_remark = db.Column(db.Text)
    sku_status = db.Column(db.String(20))
    bypass_recount = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=get_ph_time, onupdate=get_ph_time)


class CountingSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    warehouse = db.Column(db.String(100))
    session_date = db.Column(db.DateTime, default=get_ph_time)
    is_completed = db.Column(db.Boolean, default=False)

    user = db.relationship('User', backref='counting_sessions')


class CountRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('counting_session.id'))
    sku_id = db.Column(db.Integer, db.ForeignKey('skus.id'))
    initial_count = db.Column(db.Float, default=0)
    recount_count = db.Column(db.Float, default=0)
    final_count = db.Column(db.Float, default=0)
    remarks = db.Column(db.Text)
    is_recount_needed = db.Column(db.Boolean, default=False)
    recount_completed = db.Column(db.Boolean, default=False)
    count_time = db.Column(db.DateTime, default=get_ph_time)
    version = db.Column(db.Integer, default=1)

    session = db.relationship('CountingSession', backref='count_records')
    sku = db.relationship('SKU', backref='count_records')


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    action = db.Column(db.String(200))
    details = db.Column(db.Text)
    ip_address = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=get_ph_time)

    user = db.relationship('User', backref='audit_logs')

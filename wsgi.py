import sys
import os

# Add your project directory to the path
path = '/home/yourusername/mysite'  # Change 'yourusername' to your actual username
if path not in sys.path:
    sys.path.append(path)

# Set environment variables
os.environ['DB_USERNAME'] = 'admin'  # Change this!
os.environ['DB_PASSWORD'] = 'admin123'  # Change this!
os.environ['DB_NAME'] = 'webapp$inventory'  # Change this!

# Import your app
from app import app as application
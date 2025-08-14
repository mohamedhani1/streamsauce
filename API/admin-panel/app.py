from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import requests
import json
from datetime import datetime, timedelta, timezone
import os

import util

app = Flask(__name__)
app.secret_key = '12d0db4611a7405dde7c901713fa2ba1'

# Configuration
API_BASE_URL = 'http://127.0.0.1:65000/api'

class APIClient:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()

    def login(self, username, password):
        """Login to the API and store the token"""
        try:
            response = self.session.post(f'{self.base_url}/login', json={
                'username': username,
                'password': password
            })

            if response.status_code == 200:
                data = response.json()
                token = data.get('token')
                if token:
                    # Store token in session headers
                    self.session.headers.update({'Authorization': f'Bearer {token}'})
                    return True, data

            return False, response.json() if response.status_code != 500 else {'error': 'Server error'}
        except Exception as e:
            return False, {'error': str(e)}

    def get(self, endpoint):
        """Make GET request to API"""
        try:
            response = self.session.get(f'{self.base_url}/admin{endpoint}')
            return response.status_code == 200, response.json()
        except Exception as e:
            return False, {'error': str(e)}

    def post(self, endpoint, data):
        """Make POST request to API"""
        try:
            response = self.session.post(f'{self.base_url}/admin{endpoint}', json=data)
            return response.status_code in [200, 201], response.json()
        except Exception as e:
            return False, {'error': str(e)}

    def put(self, endpoint, data):
        """Make PUT request to API"""
        try:
            response = self.session.put(f'{self.base_url}/admin{endpoint}', json=data)
            return response.status_code == 200, response.json()
        except Exception as e:
            return False, {'error': str(e)}

    def delete(self, endpoint):
        """Make DELETE request to API"""
        try:
            response = self.session.delete(f'{self.base_url}/admin{endpoint}')
            return response.status_code == 200, response.json()
        except Exception as e:
            return False, {'error': str(e)}

# Initialize API client
api_client = APIClient(API_BASE_URL)

def require_auth(f):
    """Decorator to require authentication"""
    def decorated_function(*args, **kwargs):
        if 'authenticated' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/')
def index():
    if 'authenticated' in session:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))

@app.route('/test')
def test():
    return render_template('tests.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        success, result = api_client.login(username, password)

        if success:
            session['authenticated'] = True
            session['token'] = result.get('token')
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error=result.get('error', 'Login failed'))

    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    api_client.session.headers.pop('Authorization', None)
    return redirect(url_for('login'))

@app.route('/dashboard')
@require_auth
def dashboard():
    return render_template('dashboard.html')

# Channel routes
@app.route('/channels')
@require_auth
def channels():
    success, data = api_client.get('/channels')
    channels = data if success else []
    return render_template('channels.html', channels=channels)

@app.route('/channels/add', methods=['GET', 'POST'])
@require_auth
def add_channel():
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo'],
            'mpd': request.form['mpd'],
            'key': request.form['key'],
            'expires_every': int(request.form['expires_every']) if request.form['expires_every'] else 3600,
            'last_refreshed': datetime.now(timezone.utc).isoformat()
        }
        
        success, result = api_client.post('/channels', data)
        if success:
            # Add channel to package if selected
            package_id = request.form.get('package_id')
            if package_id and result.get('id'):
                api_client.post(f'/packages/{package_id}/channels/{result["id"]}', {})
            
            return redirect(url_for('channels'))
        else:
            return render_template('add_channel.html', error=result.get('error'))

    # Get packages for dropdown
    success, packages = api_client.get('/packages')
    return render_template('add_channel.html', packages=packages if success else [])
            
@app.route('/channels/edit/<int:channel_id>', methods=['GET', 'POST'])
@require_auth
def edit_channel(channel_id):
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo'],
            'mpd': request.form['mpd'],
            'key': request.form['key'],
            'expires_every': int(request.form['expires_every']) if request.form['expires_every'] else 3600
        }
        success, result = api_client.put(f'/channels/{channel_id}', data)
        if success:
            return redirect(url_for('channels'))
        else:
            return render_template('edit_channel.html', error=result.get('error'))

    # Get channel data
    success1, channels = api_client.get(f'/channels')
    success2 = [ch for ch in channels if ch['id'] == channel_id]
    if not success1 and not success2:
        return redirect(url_for('channels'))

    channel = success2[0]
    return render_template('edit_channel.html', channel=channel)

@app.route('/channels/delete/<int:channel_id>')
@require_auth
def delete_channel(channel_id):
    api_client.delete(f'/channels/{channel_id}')
    return redirect(url_for('channels'))

# Package routes
@app.route('/packages')
@require_auth
def packages():
    success, data = api_client.get('/packages')
    packages = data if success else []
    print(packages)
    return render_template('packages.html', packages=packages)

@app.route('/packages/add', methods=['GET', 'POST'])
@require_auth
def add_package():
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo']
        }

        success, result = api_client.post('/packages', data)
        if success:
            return redirect(url_for('packages'))
        else:
            return render_template('add_package.html', error=result.get('error'))

    return render_template('add_package.html')

@app.route('/packages/edit/<int:package_id>', methods=['GET', 'POST'])
@require_auth
def edit_package(package_id):
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo']
        }

        success, result = api_client.put(f'/packages/{package_id}', data)
        if success:
            return redirect(url_for('packages'))
        else:
            return render_template('edit_package.html', error=result.get('error'))

    # Get package data
    success, package = api_client.get(f'/packages/{package_id}')
    if not success:
        return redirect(url_for('packages'))

    return render_template('edit_package.html', package=package)

@app.route('/packages/delete/<int:package_id>')
@require_auth
def delete_package(package_id):
    api_client.delete(f'/packages/{package_id}')
    return redirect(url_for('packages'))

# User routes
@app.route('/users')
@require_auth
def users():
    success, data = api_client.get('/users')
    users = data if success else []
    return render_template('users.html', users=users)

@app.route('/users/add', methods=['GET', 'POST'])
@require_auth
def add_user():
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'tele_username': request.form['tele_username'],
            'avatar': request.form['avatar'],
            'reference': request.form['reference'],
            'is_admin': request.form.get('is_admin') == 'on',
            'is_hoster': request.form.get('is_hoster') == 'on'
        }

        if request.form.get('iptv_hoster_id'):
            data['iptv_hoster_id'] = int(request.form['iptv_hoster_id'])

        success, result = api_client.post('/users', data)
        if success:
            return redirect(url_for('users'))
        else:
            return render_template('add_user.html', error=result.get('error'))

    # Get hosters for dropdown
    success, hosters = api_client.get('/hosters')
    return render_template('add_user.html', hosters=hosters if success else [])

@app.route('/users/edit/<int:user_id>', methods=['GET', 'POST'])
@require_auth
def edit_user(user_id):
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'tele_username': request.form['tele_username'],
            'avatar': request.form['avatar'],
            'reference': request.form['reference'],
            'is_admin': request.form.get('is_admin') == 'on',
            'is_hoster': request.form.get('is_hoster') == 'on'
        }

        if request.form.get('iptv_hoster_id'):
            data['iptv_hoster_id'] = int(request.form['iptv_hoster_id'])

        success, result = api_client.put(f'/users/{user_id}', data)
        if success:
            return redirect(url_for('users'))
        else:
            return render_template('edit_user.html', error=result.get('error'))

    # Get user data
    success, user = api_client.get(f'/users/{user_id}')
    if not success:
        return redirect(url_for('users'))

    # Get hosters for dropdown
    success, hosters = api_client.get('/hosters')
    return render_template('edit_user.html', user=user, hosters=hosters if success else [])

@app.route('/users/delete/<int:user_id>')
@require_auth
def delete_user(user_id):
    api_client.delete(f'/users/{user_id}')
    return redirect(url_for('users'))

# Subscription routes
@app.route('/subscriptions')
@require_auth
def subscriptions():
    success, data = api_client.get('/subscriptions')
    subscriptions = data if success else []
    return render_template('subscriptions.html', subscriptions=subscriptions)

@app.route('/subscriptions/add', methods=['GET', 'POST'])
@require_auth
def add_subscription():
    if request.method == 'POST':
        # Parse datetime inputs and ensure UTC with 'Z' suffix
        started_dt = datetime.fromisoformat(request.form['started']) if request.form['started'] else datetime.now(timezone.utc)
        end_dt = datetime.fromisoformat(request.form['end']) if request.form['end'] else (datetime.now(timezone.utc) + timedelta(days=30))

        # Ensure datetime is timezone-aware in UTC
        if started_dt.tzinfo is None:
            started_dt = started_dt.replace(tzinfo=timezone.utc)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)

        # Format as RFC3339
        started = started_dt.isoformat().replace("+00:00", "Z")
        end = end_dt.isoformat().replace("+00:00", "Z")

        data = {
            'user_id': int(request.form['user_id']),
            'started': started,
            'end': end,
            'payed': float(request.form['payed']) if request.form['payed'] else 0.0,
            'key': request.form['key'] if request.form.get('key') else util.generate_key()
        }

        success, result = api_client.post('/subscriptions', data)
        if success:
            return redirect(url_for('subscriptions'))
        else:
            return render_template('add_subscription.html', error=result.get('error'))

    # Get users for dropdown
    success, users = api_client.get('/users')
    return render_template('add_subscription.html', users=users if success else [])

@app.route('/subscriptions/edit/<int:subscription_id>', methods=['GET', 'POST'])
@require_auth
def edit_subscription(subscription_id):
    if request.method == 'POST':
        # Parse datetime inputs
        started = datetime.fromisoformat(request.form['started']).isoformat() if request.form['started'] else datetime.now().isoformat()
        end = datetime.fromisoformat(request.form['end']).isoformat() if request.form['end'] else (datetime.now() + timedelta(days=30)).isoformat()

        data = {
            'user_id': int(request.form['user_id']),
            'started': started,
            'end': end,
            'payed': float(request.form['payed']) if request.form['payed'] else 0.0,
            'key': request.form['key']
        }

        success, result = api_client.put(f'/subscriptions/{subscription_id}', data)
        if success:
            return redirect(url_for('subscriptions'))
        else:
            return render_template('edit_subscription.html', error=result.get('error'))

    # Get subscription data
    success, subscription = api_client.get(f'/subscriptions/{subscription_id}')
    if not success:
        return redirect(url_for('subscriptions'))

    # Get users for dropdown
    success, users = api_client.get('/users')
    return render_template('edit_subscription.html', subscription=subscription, users=users if success else [])

@app.route('/subscriptions/delete/<int:subscription_id>')
@require_auth
def delete_subscription(subscription_id):
    api_client.delete(f'/subscriptions/{subscription_id}')
    return redirect(url_for('subscriptions'))

# IPTV Hoster routes
@app.route('/hosters')
@require_auth
def hosters():
    success, data = api_client.get('/hosters')
    hosters = data if success else []
    return render_template('hosters.html', hosters=hosters)

@app.route('/hosters/add', methods=['GET', 'POST'])
@require_auth
def add_hoster():
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo'],
            'color_palette': request.form['color_palette']
        }

        success, result = api_client.post('/hosters', data)
        if success:
            return redirect(url_for('hosters'))
        else:
            return render_template('add_hoster.html', error=result.get('error'))

    return render_template('add_hoster.html')

@app.route('/hosters/edit/<int:hoster_id>', methods=['GET', 'POST'])
@require_auth
def edit_hoster(hoster_id):
    if request.method == 'POST':
        data = {
            'name': request.form['name'],
            'logo': request.form['logo'],
            'color_palette': request.form['color_palette']
        }
        success, result = api_client.put(f'/hosters/{hoster_id}', data)
        if success:
            return redirect(url_for('hosters'))
        else:
            return render_template('edit_hoster.html', error=result.get('error'))

    # Get hoster data
    success1, hosters = api_client.get(f'/hosters')
    success2 = [hoster for hoster in hosters if hoster['id'] == hoster_id]
    if not success1 or not success2:
        return redirect(url_for('hosters'))
    
    return render_template('edit_hoster.html', hoster=success2[0])

@app.route('/hosters/delete/<int:hoster_id>')
@require_auth
def delete_hoster(hoster_id):
    api_client.delete(f'/hosters/{hoster_id}')
    return redirect(url_for('hosters'))

# API endpoints for AJAX calls
@app.route('/api/packages/<int:package_id>/channels/<int:channel_id>', methods=['POST'])
@require_auth
def add_channel_to_package_api(package_id, channel_id):
    success, result = api_client.post(f'/packages/{package_id}/channels/{channel_id}', {})
    return jsonify({'success': success, 'data': result})

@app.route('/api/packages/<int:package_id>/channels/<int:channel_id>', methods=['DELETE'])
@require_auth
def remove_channel_from_package_api(package_id, channel_id):
    success, result = api_client.delete(f'/packages/{package_id}/channels/{channel_id}')
    return jsonify({'success': success, 'data': result})

if __name__ == '__main__':
    app.run(debug=True, port=5000)

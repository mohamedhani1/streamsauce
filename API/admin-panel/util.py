import secrets
import string

def generate_key(length=16):
    """Generate a unique subscription key."""
    characters = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(characters) for _ in range(length))

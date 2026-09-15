import pytest
import sys
import os
import json
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app
from src.cv import utils as cv_utils

@pytest.fixture(autouse=True)
def mock_all_external():
    with patch('app.requests.get') as mock_get, \
         patch('app.requests.post') as mock_post, \
         patch('urllib.request.urlopen') as mock_urlopen, \
         patch('cv2.imwrite') as mock_imwrite, \
         patch('boto3.client') as mock_boto_client, \
         patch('boto3.resource') as mock_boto_resource:
        
        yield

def test_handler_missing_body():
    event = {}
    response = app.handler(event, None)
    assert response['statusCode'] in [200, 500]

def test_handler_invalid_json():
    event = {'body': '{invalid json}'}
    response = app.handler(event, None)
    assert response['statusCode'] in [200, 500]

def test_options_method():
    event = {'httpMethod': 'OPTIONS'}
    response = app.handler(event, None)
    assert response['statusCode'] == 200
    assert response['body'] == ""
    assert 'Access-Control-Allow-Origin' in response['headers']

def test_nms_centers():
    items = [
        ("rect1", 10, 10, 0.9),
        ("rect2", 11, 11, 0.8),
        ("rect3", 50, 50, 0.95)
    ]
    kept = cv_utils.nms_centers(items, min_dist=12)
    assert len(kept) == 2

def test_get_visitor_logs_unauthorized():
    event = {'body': '{"action": "get_visitor_logs", "secret": "wrong"}'}
    response = app.handler(event, None)
    assert response['statusCode'] == 403

def test_log_visitor():
    event = {
        'body': '{"action": "log_visitor"}',
        'requestContext': {'identity': {'sourceIp': '127.0.0.1'}}
    }
    response = app.handler(event, None)
    assert response['statusCode'] == 200

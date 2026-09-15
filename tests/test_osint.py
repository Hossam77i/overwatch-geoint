import pytest
from src.osint import adsb, overpass
from unittest.mock import patch

@patch('urllib.request.urlopen')
def test_adsb_parsing(mock_urlopen):
    class MockResponse:
        def read(self):
            return b'{"ac": [{"hex": "A123", "flight": "TEST", "lat": 40.0, "lon": -74.0, "alt_baro": "30000", "gs": "400"}]}'
        def __enter__(self): return self
        def __exit__(self, *args): pass
    mock_urlopen.return_value = MockResponse()
    
    result = adsb.get_radar_data(40.0, -74.0, 50)
    assert 'states' in result
    assert len(result['states']) == 1
    assert result['states'][0][0] == 'A123'
    assert result['states'][0][1] == 'TEST'

@patch('requests.post')
@patch('boto3.resource')
def test_overpass_refresh(mock_boto, mock_post):
    class MockResponse:
        status_code = 200
        def json(self):
            return {"elements": [{"tags": {"name": "Test Base"}, "lat": 10.0, "lon": 20.0}]}
    mock_post.return_value = MockResponse()
    
    # Run refresh
    count = overpass.refresh_country('EGYPT', timeout=1)
    assert count > 0

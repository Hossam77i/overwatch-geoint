import pytest
import numpy as np
import cv2
from src.cv import maritime, aviation

def test_maritime_detect_empty():
    img = np.zeros((1600, 1600, 3), dtype=np.uint8)
    num, boxes, conf, cov = maritime.detect(img)
    assert num == 0
    assert conf in [60.0, 62.0]

def test_aviation_detect_empty():
    detail = np.zeros((1600, 1600, 3), dtype=np.uint8)
    gray_d = np.zeros((1600, 1600), dtype=np.uint8)
    air_mask = np.zeros((1600, 1600), dtype=np.uint8)
    num, boxes, conf, cov = aviation.detect(detail, gray_d, air_mask)
    assert num == 0
    assert conf in [60.0, 62.0]

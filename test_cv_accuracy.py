"""CV accuracy regression test for Overwatch GEOINT (app._maritime_detect / _aviation_detect).

Run: python3 test_cv_accuracy.py
Pass criteria are sanity ranges from Sep-2026 calibration, not exact counts
(satellite frames vary with tide/traffic/palette):
- raw Suez frames: 1-35 vessels (old code swung 2 -> 270)
- annotated output re-fed: 0 (inverted-frame guard)
- Cairo airport w/ center-circle mask: 5-45 airframes, deterministic confidence 60-94
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as A

BASE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    p = os.path.join(BASE, name)
    img = cv2.imread(p)
    assert img is not None, f"missing image {p}"
    return cv2.resize(img, (1600, 1600), interpolation=cv2.INTER_CUBIC)


def test_maritime_raw():
    for name in ("suez_canal_latest.jpg",):
        img = load(name)
        n, boxes, acc, cov = A._maritime_detect(img)
        print(f"MAR {name}: n={n} acc={acc} cov={cov}")
        assert 1 <= n <= 35, f"{name}: vessel count {n} outside 1-35"
        assert 60.0 <= acc <= 94.0, f"{name}: confidence {acc} not deterministic range"
        assert 1.0 <= cov <= 70.0, f"{name}: water coverage {cov}%"


def test_maritime_rejects_annotated():
    img = load(os.path.join("assets", "suez_canal_scan.jpg"))
    n, _, acc, cov = A._maritime_detect(img)
    print(f"MAR annotated: n={n} acc={acc} cov={cov}")
    assert n == 0, f"annotated frame must be rejected, got {n}"
    assert cov > 90.0, "annotated frame should trip the >70% inversion guard"


def test_aviation_masked():
    for name in (os.path.join("assets", "cairo_airport_scan.jpg"),):
        img = load(name)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        mask = np.zeros((1600, 1600), dtype=np.uint8)
        cv2.circle(mask, (800, 800), 600, 255, -1)
        n, _, acc = A._aviation_detect(img, gray, mask)
        print(f"AV {name}: n={n} acc={acc}")
        assert 5 <= n <= 45, f"{name}: airframe count {n} outside 5-45"
        assert 60.0 <= acc <= 93.0, f"{name}: confidence {acc} out of range"


def test_determinism():
    img = load("suez_canal_latest.jpg")
    r1 = A._maritime_detect(img)
    r2 = A._maritime_detect(img)
    assert (r1[0], r1[2]) == (r2[0], r2[2]), "maritime must be deterministic (no random confidence)"


if __name__ == "__main__":
    test_maritime_raw()
    test_maritime_rejects_annotated()
    test_aviation_masked()
    test_determinism()
    print("ALL CV TESTS PASSED")

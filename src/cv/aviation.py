import cv2
import numpy as np
import math
from .utils import nms_centers

def detect(detail1600, gray_d, air_mask, width_deg=0.05):
    """Scale-aware airframe detector.
    Dynamically scales area and length limits based on zoom level to eliminate false positives on ground clutter.
    """
    # Base scale is calculated against the 0.05 default zoom (where 1600px ~ 5km)
    scale = 0.05 / max(0.001, width_deg)
    scale2 = scale * scale

    tophat = cv2.morphologyEx(
        gray_d,
        cv2.MORPH_TOPHAT,
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (int(21 * scale), int(21 * scale))
        ),
    )
    blackhat = cv2.morphologyEx(
        gray_d,
        cv2.MORPH_BLACKHAT,
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (int(21 * scale), int(21 * scale))
        ),
    )
    kept = []
    for pct in (97.5, 98.0, 98.5, 99.0, 99.5, 99.8):
        _, tmw = cv2.threshold(
            tophat, float(np.percentile(tophat, pct)), 255, cv2.THRESH_BINARY
        )
        _, tmb = cv2.threshold(
            blackhat, float(np.percentile(blackhat, pct)), 255, cv2.THRESH_BINARY
        )
        tm = cv2.bitwise_and(
            cv2.bitwise_or(tmw, tmb), cv2.bitwise_or(tmw, tmb), mask=air_mask
        )
        cnts, _ = cv2.findContours(tm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        scored = []
        for cnt in cnts:
            rect = cv2.minAreaRect(cnt)
            (rcx, rcy), (w, h), _ = rect

            # Dynamically scale bounding box limitations
            if min(w, h) < (1 * scale) or max(w, h) > (45 * scale):
                continue
            area = w * h
            ar = max(w, h) / max(1e-6, min(w, h))
            ext = cv2.contourArea(cnt) / area if area > 0 else 0
            if area < (25 * scale2) or area > (1500 * scale2) or ext < 0.15:
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            pad = int(6 * scale)
            x0, y0 = max(0, x - pad), max(0, y - pad)
            x1, y1 = min(1600, x + bw + pad), min(1600, y + bh + pad)
            ring = gray_d[y0:y1, x0:x1].astype(np.float32)
            inner = gray_d[y : y + bh, x : x + bw].astype(np.float32)
            if ring.size == 0 or inner.size == 0:
                continue
            contrast = abs(float(inner.mean()) - float(ring.mean()))
            if contrast < 6:
                continue
            if len(cnt) < 4:
                continue

            cov = float(cv2.countNonZero(tm[y0:y1, x0:x1])) / max(
                1, (x1 - x0) * (y1 - y0)
            )
            score = (
                0.35 * min(1.0, area / (300.0 * scale2))
                + 0.35 * min(1.0, ext)
                + 0.30 * min(1.0, contrast / 50.0)
            )
            if score < 0.25:
                continue
            scored.append((rect, rcx, rcy, score, contrast, ext))

        kept.extend(scored)

    if not kept:
        return 0, [], 62.0, 0.0

    kept = nms_centers(kept, min_dist=int(12 * scale))[:40]
    n = len(kept)
    if n == 0:
        return 0, [], 62.0, 0.0
    mean_score = sum(k[3] for k in kept) / n
    conf = min(99.6, 85.0 + (12.0 * mean_score) + (2.5 * math.log1p(n)))
    return n, [(k[0], k[1], k[2], k[3]) for k in kept], round(conf, 1), 0.0

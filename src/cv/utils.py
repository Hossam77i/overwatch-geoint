import math

def nms_centers(items, min_dist=12):
    """Greedy NMS by center distance. items: (rect, cx, cy, score, ...). Highest score wins."""
    items = sorted(items, key=lambda t: -t[3])
    kept = []
    for it in items:
        _, cx, cy, sc, *_ = it
        if all(math.hypot(cx - ox, cy - oy) >= min_dist for _, ox, oy, _, *_ in kept):
            kept.append(it)
    return kept

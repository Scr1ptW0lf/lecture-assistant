from difflib import SequenceMatcher


def detect_name(text: str, student_name: str, threshold: float = 0.80) -> bool:
    """Return True if student_name appears in text via exact or fuzzy match."""
    if not student_name:
        return False

    name_lower = student_name.lower().strip()

    # Short names: exact match only to avoid false positives
    if len(name_lower) < 3:
        return name_lower in text.lower()

    text_lower = text.lower()

    # Fast path: exact substring
    if name_lower in text_lower:
        return True

    # Fuzzy sliding-window match — handles mispronunciation/mishearing
    name_words = name_lower.split()
    text_words = text_lower.split()
    window_size = len(name_words)

    for i in range(max(1, len(text_words) - window_size + 1)):
        window = " ".join(text_words[i : i + window_size])
        if SequenceMatcher(None, name_lower, window).ratio() >= threshold:
            return True

    return False

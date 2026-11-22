from services.redaction import EMAIL, NAME, PHONE, PatternRedactor

redact = PatternRedactor().redact


def test_names_with_a_cue_are_removed():
    assert redact("Spoke with a woman named Maria Lopez at 35th and Center.") == (
        f"Spoke with a woman named {NAME} at 35th and Center."
    )
    assert redact("Her son Devon is 9.") == f"Her son {NAME} is 9."
    assert redact("Ms. Jones said the landlord changed the locks.") == f"{NAME} said the landlord changed the locks."
    assert redact("Hi, I'm Jordan and I need a ride.") == f"Hi, I'm {NAME} and I need a ride."


def test_contact_details_are_removed():
    assert redact("Call her at (414) 555-0182 or 414.555.0199.") == f"Call her at {PHONE} or {PHONE}."
    assert redact("Email jordan.lee+mke@example.com please") == f"Email {EMAIL} please"


def test_ordinary_words_after_a_cue_stay():
    text = "This is serious. I called back later. I'm Fine with that. This is Milwaukee Avenue."
    assert redact(text) == text


def test_addresses_stay_because_staff_need_the_location():
    assert redact("Family at 2614 N 9th St needs a bed tonight.") == "Family at 2614 N 9th St needs a bed tonight."


def test_a_bare_name_with_no_cue_is_missed_which_is_why_the_app_says_best_effort():
    assert redact("Keisha was crying.") == "Keisha was crying."


def test_find_phone_returns_the_callback_number_as_written():
    from services.redaction import find_phone

    assert find_phone("needs a ride; call back at 414-555-0199 tonight") == "414-555-0199"
    assert find_phone("no number here") is None
    assert find_phone(None) is None

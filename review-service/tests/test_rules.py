from app.rules import activity_rule_check, parse_x_status_url


def test_filters_greetings_and_short_messages() -> None:
    assert not activity_rule_check("gm")[0]
    assert not activity_rule_check("https://example.com")[0]
    assert activity_rule_check("I tested the new Arena workflow and the retry step worked well.")[0]


def test_parses_x_status_url() -> None:
    assert parse_x_status_url("https://x.com/spoonos/status/123") == ("spoonos", "123")

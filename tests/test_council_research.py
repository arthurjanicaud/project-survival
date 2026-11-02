from operations.council_collect import compact_espn


def test_compact_scoreboard_preserves_current_scores_clock_and_typed_records():
    raw = {"events": [{"id": "game", "name": "A vs B", "date": "2026-11-02T10:00Z",
        "competitions": [{"status": {"type": {"state": "in"}, "period": 2, "displayClock": "12:30"},
            "venue": {"fullName": "Verified arena"}, "competitors": [
                {"team": {"id": "1", "displayName": "A"}, "score": "2", "records": [
                    {"type": "total", "summary": "ambiguous", "stats": [{"name": "wins", "value": 3}]}]},
                {"team": {"id": "2", "displayName": "B"}, "score": "1"}]}]}]}
    event = compact_espn(raw)["events"][0]
    assert event["status"]["displayClock"] == "12:30"
    competition = event["competitions"][0]
    assert competition["venue"]["fullName"] == "Verified arena"
    assert [t["score"] for t in competition["competitors"]] == ["2", "1"]
    assert competition["competitors"][0]["records"][0]["stats"][0]["name"] == "wins"


def test_tennis_groupings_keep_both_players_without_fabricating_scores():
    raw = {"events": [{"id": "tournament", "groupings": [{"competitions": [
        {"date": "2026-11-02T12:00Z", "competitors": [
            {"athlete": {"displayName": "Player A", "id": "1"}},
            {"athlete": {"displayName": "Player B", "id": "2"}}]}]}]}]}
    event = compact_espn(raw)["events"][0]
    assert event["name"] == "Player A vs Player B"
    assert all("score" not in t for t in event["competitions"][0]["competitors"])

from operations.council_collect import compact_espn,due_dota_urls


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

def test_doubles_preserve_roster_names_set_scores_and_winner_without_fabricating_match_score():
    raw={'events':[{'groupings':[{'competitions':[{'date':'2026-11-23T12:00Z','competitors':[
        {'type':'team','roster':{'displayName':'A / B','athletes':[{'displayName':'A'},{'displayName':'B'}]},'linescores':[{'value':6}],'winner':True},
        {'type':'team','roster':{'displayName':'C / D','athletes':[{'displayName':'C'},{'displayName':'D'}]},'linescores':[{'value':3}],'winner':False}]}]}]}]}
    event=compact_espn(raw)['events'][0]
    assert event['name']=='A / B vs C / D'
    a=event['competitions'][0]['competitors'][0]
    assert a['roster']['athletes'][1]['displayName']=='B' and a['linescores'][0]['value']==6 and a['winner'] is True
    assert 'score' not in a

def test_recent_team_feed_never_suppresses_an_explicit_request_for_team_match_history():
    teams='https://api.opendota.com/api/teams';history=teams+'/123/matches'
    assert due_dota_urls([teams,history],[{'url':history}],True)==[history]
    assert due_dota_urls([teams,history],[],False)==[teams,history]

"""Verify a test server's forecast API; creates and removes one temporary user."""

import datetime as dt
import json
import os
import secrets
import urllib.error
import urllib.request
import uuid


class Client:
    def __init__(self, base, token=None):
        self.base = base
        self.token = token

    def request(self, method, path, data=None, expected=200):
        authorization = 'MediaBrowser Client="TaskTimeline integration", Device="Test", DeviceId="tasktimeline-forecast-test", Version="0.0.0"'
        if self.token:
            authorization += f', Token="{self.token}"'
        request = urllib.request.Request(
            self.base + path,
            data=None if data is None else json.dumps(data).encode(),
            method=method,
            headers={"Authorization": authorization, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status, body = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, body = error.code, error.read()
        assert status == expected, f"{method} {path.split('?')[0]}: expected {expected}, received {status}"
        return json.loads(body) if body and status == 200 else None

    def login(self, name, password):
        result = self.request("POST", "/Users/AuthenticateByName", {"Username": name, "Pw": password})
        self.token = result["AccessToken"]


def instant(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def verify(base, username, password):
    anonymous = Client(base)
    info = anonymous.request("GET", "/System/Info/Public")
    anonymous.request("GET", "/TaskTimeline/Forecast", expected=401)
    admin = Client(base)
    admin.login(username, password)
    user_id = None
    regular = Client(base)
    try:
        native = admin.request("GET", "/ScheduledTasks")
        forecast = admin.request("GET", "/TaskTimeline/Forecast")
        start, end = instant(forecast["rangeStart"]), instant(forecast["rangeEnd"])
        assert end - start == dt.timedelta(hours=168)
        assert start == instant(forecast["generatedAt"])
        assert forecast["serverTimeZone"]
        assert {x["taskId"] for x in forecast["tasks"]} == {x["Id"] for x in native}
        assert len(forecast["triggers"]) == sum(len(x["Triggers"]) for x in native)
        sources = {x["sourceId"]: x for x in forecast["triggers"]}
        occurrences = {x["occurrenceId"]: x for x in forecast["occurrences"]}
        assert len(sources) == len(forecast["triggers"])
        assert len(occurrences) == len(forecast["occurrences"])
        for source in sources.values():
            if source["type"] == "IntervalTrigger":
                assert source["projectionStatus"] in ("timingUnknown", "unsupported")
        for occurrence in occurrences.values():
            assert start <= instant(occurrence["projectedStart"]) < end
            source = sources[occurrence["sourceId"]]
            assert source["projectionStatus"] == "projected"
            assert source["taskId"] == occurrence["taskId"]
            assert source["type"] in ("DailyTrigger", "WeeklyTrigger")
            if occurrence["lastRecordedDurationMs"] is None:
                assert occurrence["estimatedEnd"] is None
        seen_pairs = set()
        for overlap in forecast["overlaps"]:
            pair = frozenset((overlap["firstOccurrenceId"], overlap["secondOccurrenceId"]))
            assert len(pair) == 2 and pair not in seen_pairs
            seen_pairs.add(pair)
            first, second = (occurrences[key] for key in pair)
            assert first["taskId"] != second["taskId"]
            if overlap["kind"] == "sameStart":
                assert first["projectedStart"] == second["projectedStart"]
                assert overlap["windowStart"] is None and overlap["windowEnd"] is None
            else:
                assert overlap["kind"] == "possibleDurationOverlap"
                assert instant(overlap["windowStart"]) < instant(overlap["windowEnd"])

        temporary_name = "TaskTimeline-check-" + uuid.uuid4().hex[:10]
        temporary_password = secrets.token_urlsafe(24)
        user = admin.request("POST", "/Users/New", {"Name": temporary_name, "Password": temporary_password})
        user_id = user["Id"]
        regular.login(temporary_name, temporary_password)
        regular.request("GET", "/TaskTimeline/Forecast", expected=403)
        print(f"PASS: Jellyfin {info['Version']}; admin/anonymous/non-admin authorization; "
              f"{len(forecast['tasks'])} tasks, {len(sources)} sources, "
              f"{len(occurrences)} occurrences, {len(forecast['overlaps'])} overlap pairs; 168-hour bounds")
    finally:
        try:
            if regular.token:
                regular.request("POST", "/Sessions/Logout", expected=204)
        finally:
            try:
                if user_id:
                    admin.request("DELETE", "/Users/" + user_id, expected=204)
            finally:
                admin.request("POST", "/Sessions/Logout", expected=204)


if __name__ == "__main__":
    verify(os.environ.get("JELLYTEST_URL", "http://127.0.0.1:8096").rstrip("/"),
           os.environ["JELLYTEST_USERNAME"], os.environ["JELLYTEST_PASSWORD"])

"""Referral history and staff call review against the real stored functions."""

from uuid import uuid4

from databridge.voice import VoiceDatabridge
from tests.integration.conftest import app_executor


async def test_referral_history_is_user_scoped_and_old_call_detail_ignores_list_limit(
    database, admin_conn
):
    user_id, other_user_id, old_call_id, other_call_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    await admin_conn.executemany(
        "INSERT INTO app.users (id, auth0_sub) VALUES ($1, $2)",
        [
            (user_id, f"auth0|{user_id.hex}"),
            (other_user_id, f"auth0|{other_user_id.hex}"),
        ],
    )
    await admin_conn.execute(
        """
        INSERT INTO app.voice_calls
            (id, conversation_id, linked_user_id, event_timestamp, started_at)
        VALUES ($1, 'old-linked-call', $2, 1, now() - interval '2 years'),
               ($3, 'other-linked-call', $4, 2, now() - interval '1 year')
        """,
        old_call_id,
        user_id,
        other_call_id,
        other_user_id,
    )
    # Push the linked call beyond voice_call_review_list's newest-200 window.
    await admin_conn.execute("""
        INSERT INTO app.voice_calls (conversation_id, event_timestamp, started_at)
        SELECT 'newer-' || n, 1000 + n, now() - (n || ' seconds')::interval
        FROM generate_series(1, 201) AS n
        """)
    resource_id = await admin_conn.fetchval(
        "SELECT id FROM app.voice_resources WHERE slug = 'milwaukee-mobile-crisis'"
    )
    referral_id = uuid4()
    await admin_conn.execute(
        """
        INSERT INTO app.voice_referrals (id, call_id, resource_id, status)
        VALUES ($1, $2, $3, 'accepted'),
               ($4, $5, $3, 'offered')
        """,
        referral_id,
        old_call_id,
        resource_id,
        uuid4(),
        other_call_id,
    )

    executor = app_executor(database)
    voice = VoiceDatabridge(executor)
    try:
        resident = await voice.referrals_for_user(user_id)
        assert [item.id for item in resident] == [referral_id]
        assert (await voice.referral_for_user(user_id, referral_id)) is not None
        assert (await voice.referral_for_user(other_user_id, referral_id)) is None

        listed_ids = {item.id for item in await voice.call_reviews()}
        assert old_call_id not in listed_ids
        old_detail = await voice.call_review(old_call_id)
        assert old_detail is not None
        assert old_detail.id == old_call_id
        assert old_detail.referral_count == 1
        assert old_detail.referral_names == ["Milwaukee Mobile Crisis"]
    finally:
        await executor.dispose()

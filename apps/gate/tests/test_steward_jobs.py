from entity_gate.steward_jobs import WriteGuard,JOBS


def test_paused_job_cannot_write_even_valid_words():
    guard=WriteGuard(lambda:True)
    assert not guard.permit('post_update',{'text':'The reading is unavailable.'})
    assert guard.writes==0


def test_unmeasured_numeric_tool_argument_is_held_before_write():
    guard=WriteGuard(lambda:False)
    assert not guard.permit('post_update',{'text':'The discharge is 999 cfs.'})
    assert guard.writes==0 and guard.held==1


def test_same_turn_reading_allows_grounded_write_then_pause_revokes():
    state={'paused':False};guard=WriteGuard(lambda:state['paused'])
    guard.observe({'readings':[{'property':'discharge','value':14.1,'unit':'cfs',
       'time':'2026-09-07T22:15:00Z','source_id':'cdss.telemetry','stale':False,
       'source_status':'ok','staleness_s':0}]})
    assert guard.permit('post_update',{'text':'The discharge is 14.1 cfs.'})
    state['paused']=True
    assert not guard.permit('post_update',{'text':'The discharge is 14.1 cfs.'})


def test_no_signing_or_unlisted_mutation_can_be_authorized():
    guard=WriteGuard(lambda:False)
    for name in ['sign_transaction','send_money','delete_entity','unpause']:
        assert not guard.permit(name,{})


def test_prd_job_cadence():
    assert JOBS['pulse'][0]=='0 * * * *'
    assert JOBS['daily-reflection'][0]=='30 6 * * *'
    assert JOBS['weekly-bounties'][0]=='0 9 * * 1'
    assert JOBS['quarterly-strategy'][0]=='0 9 1 1,4,7,10 *'
    assert JOBS['donor-report'][0]=='0 9 1 * *'

"""kami-evals — the Kami eval suite (plan T0.9, X.4, T3.6).

* ``replay``  — CI gate: recorded model replies through ``factguard`` against their fact sheets.
* ``live``    — nightly runner against the gate on the GPU box (hallucination, factual, safety,
  tool-call validity).
* ``judge``   — offline persona judge (frontier model, never on the hot path).
* ``audit``   — weekly 50-reply re-guard of released replies.
* ``finetune/`` — dataset builder, synthesiser, QLoRA trainer, promotion gate.
"""

__version__ = "0.1.0"

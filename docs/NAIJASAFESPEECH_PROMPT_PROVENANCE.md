# NaijaSafeSpeech prompt provenance

## Source

The expanded prompt bank is derived from the Hate-labeled portion of `afrihate/afrihate`, an Apache 2.0 dataset of African-language social-media text annotated by native speakers. The source provides Hausa, Igbo, Nigerian Pidgin, and Yorùbá subsets. It does not provide a separate Nigerian English subset.

Each application prompt stores:

- the source dataset name;
- the source record ID used as its linguistic or thematic basis;
- whether the prompt is a sanitized extract or a research adaptation.

## Processing decisions

User handles, URLs, repost markers, HTML entities, emoji-only material, and unrelated platform text were removed. Some source sentences were lightly normalized for a read-aloud task. Nigerian English and the requested code-switched sentences are research adaptations grounded in the selected source records. They must not be described as verbatim AfriHate rows.

The bank contains 62 optional prompts:

- 10 Hausa;
- 10 Igbo;
- 10 Yorùbá;
- 10 Nigerian Pidgin;
- 10 Nigerian English adaptations;
- 12 code-switched adaptations.

## Required human review

Before research collection, fluent native speakers should check spelling, tone marking, dialect naturalness, target-group interpretation, and whether each example is actually hateful in its local context. Reviewers should also flag direct threats, personally identifying content, and wording that is unsuitable for participant performance.

Participants must continue to see NaijaSafeSpeech as a separate, optional task. The interface should retain its warning that the scripts do not represent a participant's beliefs.

## Citation

Muhammad, Shamsuddeen Hassan, et al. 2025. “AfriHate: A Multilingual Collection of Hate Speech and Abusive Language Datasets for African Languages.” Proceedings of NAACL 2025, pages 1854 to 1871.

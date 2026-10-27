# Knowledge for the chatbot (RAG)

Every `.md` file here (except this one) is split into chunks, embedded and stored in `public.knowledge_chunks` by
`npm run ingest-knowledge`. The chatbot answers general farming questions ONLY from these chunks and names the source.

File format:

```
---
title: Name of the source and the part used
url: https://link-to-the-source       (required for every outside source)
source_id: FAO56_TABLE22        (optional: an id from public.sources)
---
Text in your own words (a short paraphrase of what the source says, not a copy of its pages).
```

Rules: one source per file; write facts you checked in the source; keep the link; add more files for FAO, extension
services or other agricultural organisations. Run `npm run ingest-knowledge` again after any change (it replaces the
chunks of a file with the same title).

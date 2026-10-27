# Namaas Knowledge Base of the chatbot (RAG)

## Overview

The `knowledge/` directory contains agricultural reference documents used to support Namaa's knowledge-based chatbot through a Retrieval-Augmented Generation (RAG) workflow.

These documents provide agricultural information that can help the chatbot answer questions about irrigation, crop water requirements, and the Namaa platform.

## Knowledge Documents

| File | Description |
|---|---|
| `fao56-crop-coefficient.md` | Explains reference evapotranspiration (ET₀), crop coefficients (Kc), and crop evapotranspiration (ETc), following the FAO-56 methodology. |
| `fao56-water-balance.md` | Covers soil water balance concepts relevant to estimating irrigation needs and tracking soil water availability. |
| `namaa-how-it-works.md` | Describes the Namaa platform and its intended workflow and functionality. |

## How the Knowledge Base Works

The knowledge ingestion workflow is designed to:

1. Read supported Markdown documents from the knowledge directory.
2. Split document content into smaller text chunks.
3. Generate embeddings for the chunks.
4. Store the resulting content and embeddings in the Supabase database table `public.knowledge_chunks`.
5. Make the indexed knowledge available to the chatbot's retrieval workflow.

The chatbot can then retrieve relevant information to help formulate answers to agricultural questions.

## Adding or Updating Knowledge

1. Add a new agricultural reference document as a `.md` file in the `knowledge/` directory.
2. Use clear headings and concise, factual explanations.
3. Include reliable references and source links where applicable.
4. Run the knowledge ingestion command from the project root:

   ```bash
   npm run ingest-knowledge
   ```

5. Check the command output to confirm that ingestion completed successfully.
6. Test the chatbot to verify that the updated information can be retrieved and used appropriately.

**Important:** Confirm that the ingestion process updates or replaces existing chunks as intended, rather than creating unintended duplicates.

## Database Requirements

The ingestion workflow uses the Supabase table:

`public.knowledge_chunks`

The required database configuration, embedding model, and any necessary API credentials must be configured according to the project's implementation.

Do not commit secret keys, passwords, or private environment variables to the repository.

## Important Notes

- The knowledge base supports the chatbot; it is not a substitute for the irrigation decision engine.
- The presence of a document in this directory does not by itself confirm that it has been ingested into the database.
- Chatbot retrieval, source attribution, and answer quality should be verified through testing.
- Agricultural recommendations should account for crop type, growth stage, soil conditions, weather, and available sensor data when relevant.
- FAO-56 references provide a methodological foundation; local agricultural conditions may require additional validated data.

## References

- [FAO Irrigation and Drainage Paper 56 — Crop Evapotranspiration](https://www.fao.org/4/X0490E/X0490E00.htm)



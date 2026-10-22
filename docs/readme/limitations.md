# Limitations

- The checked-in Compose profile is for a controlled non-public household host. Its all-interface port binding, plain HTTP edge, existing API-key bypass semantics, public registration/token model, and provider-budget controls remain accepted risks for that scope and block any claim of internet readiness.
- The current `.env` permissions and Git history/tracking of `data/credentials.json` were not remediated by the deployment reliability patch. Keep the host and repository private; if either has crossed a trust boundary, restrict file permissions, stop tracking the credential store, assess history cleanup, and rotate passwords and secrets.

- This is a local household installation, not a multi-tenant school platform, SIS, teacher roster, or classroom administration product.
- SQLite and local files are not designed for high-concurrency horizontal deployment.
- Authored practice coverage is limited to the banks listed in **Current content inventory**. Registry entries and empty curriculum shells do not imply usable course content.
- LLM semantic marking and writing feedback depend on provider availability and model quality. Deferred parent review is a safety mechanism, not an automatic grade.
- Writing scores, mock-exam bands, PSMT feedback, and diagnostic estimates are formative practice indicators; they do not replace official QCAA, NAPLAN, school, or teacher assessment.
- Neither lab is a mastery surface. Maths Lab completion and Science Lab notebooks/completion are stored in local storage; Science Lab records are isolated by active student profile, but neither lab follows a student to another device or appears on a parent’s different device. Only the independent transfer question carries learning evidence.
- Science Lab contains 18 interactive investigations mapped to AC9 Science Years 7–10, but it remains a deliberately selective supplement rather than complete coverage of all 75 curriculum topics. Partial-descriptor coverage is identified in each activity, and no Years 11–12 science is provided. The senior science curriculum slices under `data/curriculum/qcaa_senior_science/` remain empty and have no exercise banks, topic anchors, transfer questions, or scenes. On narrow phones, diagrams preserve readable labels in local overflow containers while dedicated drag handles leave ordinary page scrolling available.
- Content validators can enforce structure and flag risks, but open-ended educational content still requires qualified human review.

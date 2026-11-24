# AI configuration persistence

API profiles (including encrypted keys), synchronized provider model catalogs, and per-project chat model/thinking choices live in the backend AI data directory. Browsers connecting to the same server read the same values when opening a project or clicking Reload configurations. Selection changes are saved before being applied; revision conflicts leave the newer server choice intact and prompt the user to reload. No polling or automatic upstream model-list requests are used.

Storage location precedence: `PASCAL_AI_DATA_DIR/ai`, then `PASCAL_DATA_DIR/ai`, then the directory containing `PASCAL_DB_PATH` plus `/ai`, otherwise `~/.pascal/data/ai`. Use the same persistent directory for every startup command. To pin AI storage independently of scene data, put an absolute `PASCAL_AI_DATA_DIR` in `apps/editor/.env.local` or the deployment environment. The local installation has been pinned to `/Users/xiaohai/.pascal/data`; its previous DeepSeek profile and matching encryption key were copied from the earlier runtime directory without removing the originals.

Back up the complete AI directory, including `ai-master.key`: the encrypted `ai-profiles.json` alone cannot restore credentials. New files use owner-only permissions and atomic replacement. Project identifiers are hashed for preference filenames. Public preference responses contain no credentials. The existing same-origin and scene API access guards apply to the new endpoint as well.

The first browser with an old local model/thinking choice may import it only if the project has no backend preference yet. Existing backend preferences always win. New official model synchronizations are stored by the server; old browser-only catalogs can be updated once using Sync models. Built-in lists remain available without synchronization.

Automatic application consent remains session-only, defaults off after reload/project changes, and cannot be persisted through this endpoint. Chat message history remains in browser session storage; it is not part of configuration synchronization. This standalone deployment shares settings per server/project, not per user account.

Validation: independent clients and reopened stores read the same selection; projects remain isolated; stale writes fail with 409; unavailable models, unsupported thinking, invalid fields and cross-origin writes are rejected; synchronized catalogs survive reopening and failed resynchronization retains the previous list.

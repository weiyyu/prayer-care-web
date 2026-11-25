# 網頁版雲端建置與安全驗收

## GitHub Pages 測試版

測試站網址：`https://weiyyu.github.io/prayer-care-web/`。GitHub Pages 網址公開可開啟；資料仍需 Supabase 帳號登入。不要把站點公開可見誤當成資料已完成跨帳號隔離驗收。

部署使用 `.github/workflows/deploy.yml`，在 GitHub Repository Variables 設定 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。這兩項是前端可公開的連線設定；`service_role`、secret key、帳號密碼與 `.env.local` 絕不可上傳。正式網址須加入 Supabase Authentication 的 Site URL／Redirect URLs，否則驗證信與重設密碼可能回到本機網址。

代禱者照片存於私人 Storage 桶，資料表僅保存路徑。新照片以每人固定路徑保存；換照覆寫原檔，編輯檔案可單獨移除照片，刪除代禱者也會先清除照片。這不會自動清理舊版本可能遺留的孤兒檔案。正式使用前仍須驗收實際雲端照片上傳／覆寫／刪除及雙帳號隔離。

已連接新的 Supabase 專案。2026/11/24 查核遠端資料庫：三張應用資料表皆啟用 RLS，讀寫政策皆限制 `owner_id = auth.uid()`；匿名角色對三張表都沒有 SELECT/INSERT/UPDATE/DELETE 權限，匿名 REST 讀取實測均回 HTTP 401。這是設定與匿名存取驗收，**不是雙帳號隔離實測**。單一帳號已完成帳密註冊、信箱驗證和登入；用明確標記的虛構資料驗收新增、編輯、訪談連動代禱、已代禱／恢復、蒙應允後編輯訪談不重開事項、搜尋、代禱卡、重新整理持久化及手機寬度。測試資料目前保留在雲端。照片上傳因 Chrome 的 ChatGPT 擴充功能缺少本機檔案存取權而未完成，檔案未送出。尚未完成雙帳號與照片隔離、還原測試；此階段請勿輸入真實關懷資料，也不要把 Android 備份直接匯入。

## 先準備

1. 在 Supabase 建立一個新專案，記下 Project URL 和 **publishable key**（舊介面可能稱 `anon` key）。不要把 `service_role` 或 secret key 放進網頁、`.env.local`、對話或公開儲存庫。
2. 新專案先在 SQL Editor 檢視並執行 [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql)，再執行 [`supabase/migrations/002_prayer_checks.sql`](supabase/migrations/002_prayer_checks.sql)。001 只適用空白專案；已有資料的專案只需執行尚未套用的 002，不可重跑 001。002 新增逐日禱告紀錄與本人可讀寫的 RLS，將舊「已代禱」標記補成一筆歷史紀錄，不刪除原有資料。**先完成並驗證 002，再部署使用新版每日紀錄的前端。**

目前連接的測試專案已於 2026/11/25 套用 002。SQL Editor 查核：新表 RLS 已開啟、匿名不可讀、登入角色有 SELECT／INSERT／DELETE，且存在本人限定政策；套用前舊「已代禱」標記為 0 筆。這不等同於完成雙帳號或登入後逐日紀錄實測。
3. 在 Authentication > Sign In / Providers 啟用 Email，保留 Confirm Email；設定 Site URL 與 Redirect URLs，至少包含本機 `http://127.0.0.1:5179/`，正式上線時再加正式 HTTPS 網址。網頁採電子郵件與密碼註冊／登入，首次驗證及忘記密碼才寄信。
4. 複製 `.env.example` 為 `.env.local`，填入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。重啟 `npm run dev -- --port 5179 --strictPort`。
5. 先用 Supabase 專案團隊成員的信箱註冊帳密，並在同一台執行本機伺服器的電腦開啟首次驗證信。Supabase 內建寄信服務只寄給團隊成員且有限流；第二個測試帳號需先配置自訂 SMTP，或在可丟棄的本機 Supabase 測試環境完成。之後分別建立虛構代禱者、代禱事項、訪談與照片；A 登出後改登入 B，確認 B 只能看到 B 的資料，反向也要測。

## 不可跳過的驗收

- 用 B 的登入狀態直接查詢 A 的三張資料表 ID，應讀不到；直接修改、刪除 A 的 ID，也應影響 0 筆。
- 嘗試在 B 的資料中指定 A 的 `person_id`，資料庫應拒絕，不可只靠表單選項阻擋。
- 照片桶必須是 `public = false`。B 不能列出、下載、覆寫或刪除 A 的照片；匿名訪客也不能讀取。
- A 登出、B 登入時，畫面不應短暫顯示 A 的姓名或照片。測試慢速網路和重新整理。
- 訪談填入「代禱」後，恰好新增一筆連動事項；只改訪談地點，不可讓已蒙應允的事項重新出現。
- 測試資料刪除與還原流程。尚未驗收完成前，不要輸入真實關懷紀錄。

## 本機 SQL 測試

在安裝 Supabase CLI 和 Docker 的**可丟棄本機測試環境**後，執行 `supabase start`、套用 migration，然後執行 `supabase test db`。測試檔是 [`supabase/tests/tenant_isolation_test.sql`](supabase/tests/tenant_isolation_test.sql)，在交易結尾 `rollback`。不要對有真實資料的雲端資料庫執行測試檔，也不要用 `supabase db reset` 清除既有資料。

## 雙帳號雲端唯讀檢查

`npm run test:isolation` 會以兩個已驗證的測試帳號登入，分別讀取三張表的 `id` 與 `owner_id`，再以對方列的 ID 查詢是否可見。它不會新增、編輯或刪除應用資料，但登入會照常經過 Supabase Auth。需先在兩個帳號各建立至少一位虛構人物、一筆訪談和一筆代禱事項，才能對三張表都得到完整結論。

1. 複製 `.env.isolation.example` 為 `.env.isolation.local`。
2. 填入兩個不同、已完成信箱驗證的**測試帳號**與密碼。不要用主要帳號密碼；此檔已由 `.gitignore` 排除，不可提交或分享。
3. 在專案資料夾執行 `npm run test:isolation`。只回報每表筆數與隔離結果，不顯示帳號、資料內容或 ID。
4. 移除本機測試憑證檔，並在兩個測試帳號中自行刪除測試資料（如要刪除雲端資料，先確認帳號內只有可丟棄的測試內容）。

這只驗證三張資料表的讀取隔離，不包含跨帳號編輯／刪除攻擊、照片隔離、帳號登出切換及備份還原；這些仍需另行驗收。

## 備份現況

目前 Supabase 儀表板顯示 **No backups**。正式使用前需要設計並演練「資料表 + 私人照片」的異地備份與還原；單獨匯出資料庫 SQL 不包含 Storage 的照片檔。暫時不要把雲端同步誤認為備份。若之後採用定時工作，憑證只能存於受保護的伺服端密鑰區，不可放在前端。

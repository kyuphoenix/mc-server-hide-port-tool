# Minecraft 绔彛闅愯棌宸ュ叿

鍩轰簬 Cloudflare Workers + Hono + better-auth 瀹炵幇鐨?Minecraft 绔彛闅愯棌宸ュ叿銆傞€氳繃 Cloudflare DNS SRV 璁板綍璁╃帺瀹舵棤闇€杈撳叆绔彛鍙峰嵆鍙繛鎺ユ湇鍔″櫒銆?
涓昏鐗规€э細

- **棣栨鍚姩鑷姩 onboarding**锛氭娴嬪埌鏃犵敤鎴锋椂寮哄埗璺宠浆 `/setup` 鍒涘缓棣栦釜绠＄悊鍛樺苟鐩存帴鐧诲綍锛涢涓敤鎴疯嚜鍔ㄨ鏍囪涓恒€岃秴绾х鐞嗗憳銆嶏紙涓嶅彲琚叾浠栫鐞嗗憳闄嶇骇鎴栧垹闄わ級
- **澶氳鑹叉潈闄?*锛氭櫘閫氱敤鎴峰彲鍒涘缓/鍒犻櫎鑷繁鐨?DNS 璁板綍锛涚鐞嗗憳鍙闂悗鍙扮鐞嗘墍鏈夌敤鎴枫€佹墍鏈夎褰曞拰鍏ㄥ眬璁剧疆锛涚鐞嗗憳鍙湪鍚庡彴鎵嬪姩鍒涘缓鐢ㄦ埛锛堟棤闇€璧版敞鍐岄〉锛?- **鍙厤缃殑娉ㄥ唽娴佺▼**锛氱鐞嗗憳鍙湪鍚庡彴寮€鍚?鍏抽棴娉ㄥ唽锛岄€夋嫨銆岄偖绠?/ GitHub / 閭+GitHub銆嶄笁绉嶆柟寮忎箣涓€
- **閭鍚庣紑鐧?榛戝悕鍗?*锛氬彲鍚屾椂鍚敤锛屾寜鍚庣紑鍖归厤锛堟敮鎸佸瓙鍩熷悗缂€锛屽濉?`gmail.com` 浼氬悓鏃跺尮閰?`mail.gmail.com`锛?- **閭楠岃瘉鐮?*锛氬惎鐢?Resend 鍚庯紝閭娉ㄥ唽闇€鍏堟敹鍒?6 浣嶉獙璇佺爜锛涙湭鍚敤鏃惰緭鍏ラ偖绠卞瘑鐮佺洿鎺ュ畬鎴愭敞鍐?- **GitHub OAuth 娉ㄥ唽**锛氬彲闄愬畾 GitHub 璐﹀彿娉ㄥ唽鏈€鐭ぉ鏁帮紙鐢?access token 璋?`/user` 鍙?`created_at` 姣斿锛屼笉杈炬爣浼氬洖婊氬凡鍒涘缓璐﹀彿锛?- **澶氭牴鍩熷悕鏀寔**锛氭瘡涓牴鍩熷悕浣跨敤鐙珛鐨?Cloudflare API Token锛堟寜 `<鍩熷悕鐐规崲涓嬪垝绾?_CLOUDFLARE_API_TOKEN` 鍛藉悕锛夛紝鍙搴斾笉鍚?Cloudflare 璐︽埛
- **璁板綍鏁伴噺涓婇檺**锛氬叏灞€ `max_records_per_user` 鎺у埗榛樿姣忕敤鎴峰彲鍒涘缓 DNS 璁板綍鏁帮紱绠＄悊鍛樺彲鍦ㄥ悗鍙板鍗曚釜鐢ㄦ埛瑕嗙洊璇ヤ笂闄?- **瀛愬煙鍚嶆渶灏忓瓧绗﹂暱搴?*锛氬叏灞€ `min_subdomain_length` 闄愬埗瀛愬煙鍚嶆渶鐭瓧绗︽暟锛堜緥濡傝涓?4 鏃跺彧鑳界敤 `1111.example.com` 鎴栨洿闀匡級
- **D1 鎸佷箙鍖?*锛氱敤鎴枫€佷細璇濄€丏NS 璁板綍褰掑睘銆侀獙璇佺爜銆佸叏灞€璁剧疆鍏ㄩ儴瀛樹簬 Cloudflare D1
- **GitHub Actions 涓€閿儴缃?*锛欳I 鑷姩鍒涘缓 D1銆佸簲鐢ㄨ縼绉汇€佹敞鍏?secrets/vars 骞堕儴缃?Worker锛岃瑙?[閮ㄧ讲鏂规硶](#閮ㄧ讲鏂规硶)

## 鎶€鏈爤

- 杩愯鏃讹細Cloudflare Workers锛坄nodejs_compat`锛?- Web 妗嗘灦锛欻ono锛圝SX SSR锛?- 閴存潈锛歜etter-auth锛堥偖绠卞瘑鐮?+ GitHub social provider锛?- 瀛樺偍锛欳loudflare D1锛圫QLite锛?- 閭欢锛歊esend HTTP API锛圵orkers 涓嶆敮鎸?TCP锛屾棤娉曠洿杩?SMTP锛?
## 鍓嶇疆瑕佹眰

- Node.js 18+
- pnpm
- Cloudflare 璐︽埛锛屽苟宸叉坊鍔犺嚦灏戜竴涓牴鍩熷悕鍒?Cloudflare DNS
- 姣忎釜鏍瑰煙鍚嶄竴浠藉叿鏈?DNS 缂栬緫鏉冮檺鐨?Cloudflare API Token

## 鏈湴寮€鍙?
1. 瀹夎渚濊禆锛?
```txt
pnpm install
```

2. 鍒涘缓 D1 鏁版嵁搴擄紙棣栨锛夛細

```txt
pnpm wrangler d1 create mc-server-hide-port-tool-db
```

灏嗘帶鍒跺彴杩斿洖鐨?`database_id` 濉叆 `wrangler.jsonc` 鐨?`d1_databases[0].database_id` 瀛楁锛堟浛鎹?`REPLACE_WITH_D1_DATABASE_ID`锛夈€?
3. 搴旂敤杩佺Щ锛?
```txt
pnpm wrangler d1 migrations apply mc-server-hide-port-tool-db --local
```

杩佺Щ寤鸿〃娓呭崟锛?- `0000_init.sql` 鈥?better-auth 鐨?`user` / `session` / `account` / `verification` 鍥涘紶琛?- `0001_admin.sql` 鈥?`user` 琛ㄥ姞 `role` 鍒楋紝鏂板 `dns_record` / `settings` / `email_verification` 涓夊紶琛?- `0002_super_admin_and_limits.sql` 鈥?`user` 琛ㄥ姞 `super_admin` / `record_limit` 鍒楋紱`settings` 琛ㄥ姞 `max_records_per_user` / `min_subdomain_length`

4. 澶嶅埗 `.dev.vars.example` 涓?`.dev.vars` 骞跺～鍐欍€傛瘡涓牴鍩熷悕浣跨敤涓€涓嫭绔嬬殑 Cloudflare API Token锛岀幆澧冨彉閲忓悕涓?`<鍩熷悕涓殑鐐规浛鎹负涓嬪垝绾?_CLOUDFLARE_API_TOKEN`锛?
```
example_com_CLOUDFLARE_API_TOKEN=...
example_net_CLOUDFLARE_API_TOKEN=...
DOMAINS=["example.com","example.net"]
BETTER_AUTH_SECRET=openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:8787
GITHUB_CLIENT_ID=            # 浠呭綋鍚庡彴閫夋嫨 GitHub 娉ㄥ唽鏂瑰紡鏃堕渶瑕?GITHUB_CLIENT_SECRET=
```

> 鐢熶骇鐜璇风敤 `wrangler secret put BETTER_AUTH_SECRET` 绛夊懡浠よ缃瘑閽ワ紝鍒囧嬁鍐欏叆 wrangler.jsonc銆?
5. 鍚姩寮€鍙戞湇鍔″櫒锛?
```txt
pnpm dev
```

娴忚鍣ㄨ闂?`http://localhost:8787`锛?
- **棣栨鍚姩**锛坲ser 琛ㄤ负绌猴級鑷姩璺宠浆 `/setup`锛屽垱寤虹涓€涓鐞嗗憳璐︽埛鍚庣洿鎺ョ櫥褰曡繘鍏ヤ富椤?- **鍚庣画鍚姩**鏈櫥褰曞垯璺?`/login`锛岀櫥褰曞悗鏅€氱敤鎴风湅鑷繁鐨?DNS 璁板綍骞跺垱寤?鍒犻櫎锛涚鐞嗗憳棰濆鍙湅鍒般€岀鐞嗗悗鍙般€嶅叆鍙?
## 閮ㄧ讲鍒扮敓浜?
```txt
pnpm wrangler d1 migrations apply mc-server-hide-port-tool-db --remote
pnpm wrangler secret put example_com_CLOUDFLARE_API_TOKEN
pnpm wrangler secret put example_net_CLOUDFLARE_API_TOKEN    # 澶氬煙鍚嶉€愪釜 put
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID                    # 鍙€?pnpm wrangler secret put GITHUB_CLIENT_SECRET                # 鍙€?pnpm deploy
```

閮ㄧ讲瀹屾垚鍚庤闂珯鐐逛細杩涘叆 onboarding 娴佺▼锛涘垱寤虹鐞嗗憳鍚庡嵆鍙湪 `/admin` 鍚庡彴閰嶇疆娉ㄥ唽鏂瑰紡 / 閭鐧藉悕鍗?/ Resend / GitHub 璐﹀彿骞撮檺绛夈€?
## 閮ㄧ讲鏂规硶

鏀寔涓ょ閮ㄧ讲鏂瑰紡锛屽彉閲忛敭鍚嶄笌璇︾粏璇存槑璇疯瀵瑰簲鏂囨。锛?
- **鏂瑰紡涓€锛氭湰鍦板懡浠よ閮ㄧ讲** 鈥?閫傜敤棣栨閮ㄧ讲銆佽皟璇曘€佷笉鏂逛究鐢?CI 鐨勭幆澧冦€傝瑙?[`docs/deploy-local.md`](docs/deploy-local.md)
- **鏂瑰紡浜岋細GitHub Actions 涓€閿儴缃?*锛堟帹鑽愮敓浜х幆澧冿級鈥?鍦?Actions 椤甸潰鎵嬪姩瑙﹀彂鍗冲彲鑷姩瀹屾垚銆屽垱寤?D1 鈫?瑙ｆ瀽鏍瑰煙鍚?token 鈫?搴旂敤杩佺Щ 鈫?閮ㄧ讲 Worker 鈫?娉ㄥ叆 secrets/vars 鈫?缁戝畾 custom domain銆嶃€傝瑙?[`docs/deploy-github-actions.md`](docs/deploy-github-actions.md)

涓ょ鏂瑰紡鐨?*鐩殑涓庢渶缁?Worker 鎷ユ湁鐨勭幆澧冨彉閲忓畬鍏ㄤ竴鑷?*锛屼粎 secret 涓?var 鐨勬潵婧?娉ㄥ叆鏂瑰紡涓嶅悓锛?
| 鍙橀噺 | 鏈湴閮ㄧ讲 | GitHub Actions 閮ㄧ讲 |
|---|---|---|
| `APP_NAME` | `wrangler.jsonc.vars` 榛樿 `hide-port-tool` | 鍚屽乏锛孋I 涓嶈鐩?|
| `DOMAINS` | `wrangler.jsonc.vars` 鎴?`.dev.vars` 涓樉寮忓啓 JSON 鏁扮粍 | 浠?`CLOUDFLARE_DOMAINS_API_TOKEN` 瑙ｆ瀽鍑哄煙鍚嶆竻鍗曡嚜鍔ㄦ淳鐢?|
| `BETTER_AUTH_URL` | `wrangler.jsonc.vars` 鎴?`.dev.vars` | 浠撳簱 secret `BETTER_AUTH_URL`锛堟槑鏂?var锛夛紱鑻ユ寚鍚戣嚜鏈夊煙鍚嶈嚜鍔ㄧ粦 custom domain |
| `BETTER_AUTH_SECRET` | `wrangler secret put BETTER_AUTH_SECRET` 鎴?`.dev.vars` | 浠撳簱 secret `BETTER_AUTH_SECRET` |
| `<鍩熺偣鎹笅鍒掔嚎>_CLOUDFLARE_API_TOKEN` | 姣忔牴鍩熷悕鍚?`wrangler secret put` 鎴?`.dev.vars` 鍗曡 | 浠撳簱 secret `CLOUDFLARE_DOMAINS_API_TOKEN`锛坄<鍩?:<token>,<鍩?:<token>` 姹囨€伙級锛孋I 鎷嗗垎鍚庢寜鍩熷悕閫愪釜娉ㄥ叆 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 鍙€?`wrangler secret put` 鎴?`.dev.vars` | 浠撳簱鍚屽悕 secret锛屾湭璁剧疆鍒?CI 鑷姩璺宠繃 |

> 瀹屾暣瀛楁璇存槑銆佸懡浠ら『搴忋€侀闄╀笌绀轰緥璇烽槄瀵瑰簲鏂囨。銆?
## 绠＄悊鍚庡彴鍔熻兘锛坄/admin`锛?
浠?`role=admin` 鐨勭敤鎴峰彲璁块棶锛屾櫘閫氱敤鎴疯闂細琚噸瀹氬悜鍒?`/`銆?
| 妯″潡 | 璇存槑 |
|---|---|
| 娉ㄥ唽璁剧疆 | 寮€鍏虫敞鍐屻€侀€夋嫨妯″紡锛堥偖绠?GitHub/閭+GitHub锛夈€丟itHub 璐﹀彿鏈€鐭敞鍐屽ぉ鏁?|
| 閭鍚庣紑鐧?榛戝悕鍗?| 鐙珛寮€鍏?+ 鍚庣紑鍒楄〃锛堥€楀彿鍒嗛殧锛夛紝瀛愬煙鍚庣紑鑷姩鍖归厤 |
| 閭欢鏈嶅姟锛圧esend锛?| 寮€鍏炽€丄PI Key锛堢暀绌轰繚鐣欐棦鏈夊€硷級銆佸彂浠朵汉鍦板潃锛涘惎鐢ㄥ悗閭娉ㄥ唽璧?6 浣嶉獙璇佺爜娴佺▼ |
| 鐢ㄦ埛绠＄悊 | 鍒楀嚭鎵€鏈夌敤鎴枫€佽涓虹鐞嗗憳/闄嶇骇銆佸垹闄わ紙绾ц仈鍒犻櫎鍏?DNS 璁板綍鍜屼細璇濓級锛涙墜鍔ㄥ垱寤虹敤鎴凤紙鏃犻渶娉ㄥ唽椤碉級锛涢€愮敤鎴疯缃?DNS 璁板綍鏁颁笂闄?|
| 瓒呯骇绠＄悊鍛?| 棣栦釜 onboarding 鍒涘缓鐨勭敤鎴疯鏍囪涓鸿秴绾х鐞嗗憳锛屾櫘閫氱鐞嗗憳鏃犳硶闄嶇骇鎴栧垹闄?|
| 璁板綍鏁颁笂闄?| 鍏ㄥ眬 `max_records_per_user` 鎺у埗榛樿涓婇檺锛涘彲瀵瑰崟涓敤鎴疯鐩?|
| 瀛愬煙鍚嶆渶灏忛暱搴?| 鍏ㄥ眬 `min_subdomain_length` 鎺у埗瀛愬煙鍚嶆渶鐭瓧绗︽暟 |
| DNS 璁板綍绠＄悊 | 鍒楀嚭鍏ㄧ珯鎵€鏈?DNS 璁板綍銆佸垹闄ゅ崟鏉★紙鍚屾鍒犻櫎 Cloudflare 涓?A/AAAA/CNAME + SRV 璁板綍锛?|

## 绫诲瀷鐢熸垚

淇敼 `wrangler.jsonc` 鎴?`.dev.vars` 鍚庤閲嶆柊鐢熸垚绫诲瀷锛?
```txt
pnpm cf-typegen
```

`wrangler types` 浼氳嚜鍔ㄦ壂鎻?`.dev.vars` 灏嗗叾涓殑鍙橀噺娉ㄥ叆 `CloudflareBindings`锛屼緥濡?`303302_xyz_CLOUDFLARE_API_TOKEN` 浼氫互瀛楅潰閲?key 褰㈠紡鍑虹幇鍦?interface 涓€備唬鐮佷腑閫氳繃 `(env as Record<string, string|undefined>)[key]` 鍔ㄦ€佽鍙栵紝鏃犻渶鍏虫敞绫诲瀷缁嗚妭銆?
瀹炰緥鍖?Hono 鏃朵娇鐢細

```ts
// src/index.tsx
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

## 椤圭洰缁撴瀯

```
migrations/
  0000_init.sql                       # better-auth 鍩虹琛?  0001_admin.sql                      # admin 鍚庡彴鎵€闇€琛?+ 瑙掕壊瀛楁
  0002_super_admin_and_limits.sql     # 瓒呯骇绠＄悊鍛?+ 璁板綍涓婇檺 + 瀛愬煙鍚嶆渶灏忛暱搴?src/
  auth.ts                             # better-auth 瀹炰緥 + 閴存潈 helper
  index.tsx                           # Hono 璺敱 + Cloudflare API 灏佽
  services/
    settings.ts                       # D1 settings 鍗曡璇诲啓 + 閭鐧?榛戝悕鍗曟牎楠?    dns-records.ts                    # DNS 璁板綍褰掑睘琛?CRUD + 鐢ㄦ埛绠＄悊 + 闄愰 helpers
    mailer.ts                         # Resend HTTP API 鍙戦€侀獙璇佺爜
    github.ts                         # 璋冪敤 GitHub /user 鍙?created_at 鏍￠獙
  views/
    Layout.tsx                        # 閫氱敤 HTML 澶栧３
    SetupView.tsx                     # 棣栨 onboarding
    LoginView.tsx
    RegisterView.tsx                  # 鎸?settings.registration_mode 鍔ㄦ€佹覆鏌?    VerifyEmailView.tsx               # 楠岃瘉鐮佽緭鍏?    IndexView.tsx                     # 鏅€氱敤鎴蜂富椤碉紙鍚嚜宸辩殑璁板綍鍒楄〃锛?    AdminView.tsx                     # 绠＄悊鍚庡彴锛堣缃?鐢ㄦ埛/DNS 璁板綍涓夊悎涓€锛?public/static/
  main.js                             # 棣栭〉 DNS 琛ㄥ崟浜や簰锛坒etch /api/domains, /api/create-dns锛?scripts/
  resolve_env_keys.py                 # 瑙ｆ瀽 .dev.vars.example 鍖哄垎 secret/var 閿悕
.github/workflows/
  deploy.yml                          # CI锛氳嚜鍔ㄥ垱寤?D1 + 杩佺Щ + 閮ㄧ讲 + 娉ㄥ叆 secrets
docs/
  deploy-github-actions.md            # GitHub Actions 閮ㄧ讲璇︾粏璇存槑
```

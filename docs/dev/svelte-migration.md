# Svelte 杩佺Щ璁″垝锛圡yAnimeDock 鍓嶇锛?

> 鐘舵?侊細**宸茬‘璁ゆ墽琛?**锛?2026-08-13锛?
> 鍐崇瓥锛?**鐩存帴鍏ㄩ噺杩? Vite + Svelte**锛屽厛寤? Toast/Modal 缁勪欢锛岃窇璧锋潵鍚庢參鎱慨 bug銆?
> 鏈枃妗ｆ槸杩佺Щ鎵ц鐨勫敮涓?鍙傜収锛岄槻姝㈡墽琛屽亸宸??

## 1. 鑳屾櫙涓庡喅绛?

- 鍓嶇鐜扮姸锛歷anilla JS 鍏ㄥ眬鍑芥暟妯″紡锛?28 鏂囦欢锛寏9000 琛岋級锛岃嚜瀹氫箟 concat 鎻掍欢鎵撳寘锛屾棤 ES 妯″潡銆?
- 鐥涚偣锛?**缁勪欢鍏ㄦ墜鍐欍?佹棤缁勪欢绯荤粺**锛屾柊澧? UI 鏃犱粠涓嬫墜銆?
- 鍐崇瓥锛氳縼绉诲埌 **Svelte 5**锛堟棤铏氭嫙 DOM 鈫? GSAP 鏃犲啿绐侊紱浣撶Н灏? 鈫? 閫傚悎 Tauri锛涜娉曠畝娲? 鈫? 杩佺Щ鎴愭湰浣庯紱缁勪欢妯″瀷 鈫? 瑙ｅ喅鎵嬪啓缁勪欢鐥涚偣锛夈??
- 绛栫暐锛?**鐩存帴鍏ㄩ噺杩? Vite + ES module + Svelte**锛屼笉鍋氥?宑oncat 涓? Svelte 鍏卞瓨銆嶇殑娓愯繘杩囨浮锛堢敤鎴锋槑纭?夋嫨锛屾帴鍙楀悗缁慨 bug锛夈??

## 2. 璋冪爺缁撹锛?2026-08锛孈librarian锛?

| 椤? | 缁撹 |
|----|------|
| GSAP 闆嗘垚 | 鏃犺櫄鎷? DOM锛屽ぉ鐒舵棤鍐茬獊锛涚敤 `gsap.context()` + `onMount` 杩斿洖 cleanup锛屽畼鏂规爣鍑嗗仛娉? |
| Svelte 5 鐘舵?? | 宸茬ǔ瀹氾紙5.56.x锛夛紝runes 榛樿锛屾棫璇硶鏈簾寮冨彲娣风敤 |
| 娓愯繘杩佺Щ | `mount()` 鍙寕鍒扮幇鏈? DOM锛屽畼鏂规敮鎸侊紱浣嗘湰璁″垝璧板叏閲? |
| melt-ui | Svelte 鐢熸?佹渶鎴愮啛 headless 搴擄紱鏃ユ湡閫夋嫨鍣ㄨ川閲忛珮锛?**鏃犳嫋鎷?/铏氭嫙婊氬姩鏍稿績**锛岄渶绀惧尯搴? |
| Tauri v2 | 閫傞厤鎴愮啛锛?**鎺ㄨ崘绾? Svelte锛堟棤 SvelteKit锛?**锛孲PA + 鑷畾涔夎矾鐢? |
| 鐢熸?? | 鏂囨。濂姐?佺ぞ鍖烘椿璺冿紱瑙勬ā杩滃皬浜? React锛屽喎闂ㄩ棶棰樿祫鏂欏皯锛堜富瑕侀闄╋級 |

## 3. 鐩爣鏋舵瀯

```
frontend/
鈹溾攢鈹? index.html          # 鍗曚竴鍏ュ彛锛孷ite 娉ㄥ叆
鈹溾攢鈹? vite.config.js      # Vite + @sveltejs/vite-plugin-svelte锛堢Щ闄? concat 鎻掍欢锛?
鈹溾攢鈹? src/
鈹?   鈹溾攢鈹? main.js         # Svelte 鍏ュ彛锛宮ount(App)
鈹?   鈹溾攢鈹? App.svelte      # 鏍圭粍浠讹紙瑙嗗浘璺敱/甯冨眬锛?
鈹?   鈹溾攢鈹? lib/            # 鍙鐢ㄩ?昏緫锛坅pi/state/utils/i18n锛?
鈹?   鈹溾攢鈹? components/     # 閫氱敤缁勪欢锛圱oast/Modal/Dropdown/Card...锛?
鈹?   鈹斺攢鈹? views/          # 瑙嗗浘缁勪欢锛圖iscovery/Library/Detail/MyList/Stats/Settings...锛?
```

## 4. 鍒嗛樁娈垫墽琛?

### Phase 0 鈥? 鏋勫缓绯荤粺鍦板熀
- [x] 瀹夎 `svelte` + `@sveltejs/vite-plugin-svelte`
- [x] 寤? `src/main.js` + `src/App.svelte` 鍏ュ彛
- [x] 鏀? `vite.config.js`锛氬姞 Svelte 鎻掍欢锛?**绉婚櫎 concat 鎻掍欢**
- [x] 鏀? `index.html`锛氱Щ闄? 28 涓? script 鏍囩锛岀暀鍗曚竴鍏ュ彛
- [x] 澶勭悊鍐呰仈 onclick锛坄onclick="showView(...)"` 绛夛級鈫? 浜嬩欢鐩戝惉鎴栫粍浠跺唴澶勭悊
- [x] 楠岃瘉锛歚npm run check:frontend` 閫氳繃锛宒ev server 鑳借窇

### Phase 1 鈥? 缁勪欢搴撻鏋讹紙鐢ㄦ埛鎸囧畾鍏堣锛?
- [x] Toast 缁勪欢锛坄components/Toast.svelte`锛屾浛鎹? `toast.js` 鐨? showToast/dismissToast锛?
- [x] Modal 缁勪欢锛坄components/Modal.svelte`锛屾浛鎹? `ui.js` 鐨? openModal + `app.js` 鐨? showConfirm锛?
- [x] Dropdown 缁勪欢锛堟敼鐢? **bits-ui `Select`**锛屾浛鎹? `components.js` 鐨? createDropdown锛汳ylist/LocalAnimeSection/StatusModal 宸茬敤锛?
- [x] Card 缁勪欢锛坄components/AnimeCard.svelte`锛屾浛鎹? `ui.js` 鐨? renderAnimeCard锛?
- [x] 澶嶆潅缁勪欢鐢? **bits-ui** 鎷块?昏緫锛堢姸鎬佷笅鎷夌瓑锛涙棩鏈熺敤涓夋寮? + 鏍￠獙锛屾湭寮曞叆瀹屾暣鏃ュ巻锛?
- [x] 楠岃瘉锛氱粍浠跺湪 App 涓彲鐢紝鏍峰紡涓庣幇鏈? CSS 涓?鑷?

> **鍐崇瓥淇锛?2026-08-14锛?**锛歨eadless 搴撲粠 melt-ui 鏀逛负 **bits-ui**锛坄^2.18.1`锛孲velte 5 瀹樻柟鎺ㄨ崘锛夈?係tatusModal 缁勪欢搴擄紙鐘舵?佷笅鎷?/璇勫垎 stepper/杩涘害/鏃ユ湡涓夋寮忥級宸插畬鎴愶紝`enrichAnime` 缁熶竴涓夋帴鍙ｉ濉暟鎹??

### Phase 2 鈥? 瑙嗗浘娓愯繘杩佺Щ
- [x] 鎸変緷璧栭『搴忛?愯鍥捐浆 Svelte锛歴ettings 鈫? discovery 鈫? library 鈫? detail 鈫? mylist 鈫? stats
- [x] 姣忎釜瑙嗗浘锛欻TML 妯℃澘 鈫? Svelte 缁勪欢锛屽叏灞?鍑芥暟 鈫? 缁勪欢鏂规硶/妯″潡瀵煎叆
- [x] 姣忚縼绉讳竴涓鍥捐窇 `npm run check:frontend` 楠岃瘉

### Phase 3 鈥? 娓呯悊
- [x] 鍒犻櫎 concat 鎻掍欢鐩稿叧浠ｇ爜
- [x] 鍒犻櫎宸茶縼绉荤殑鏃? vanilla JS 鏂囦欢
- [x] 鍐呰仈 onclick 鍏ㄩ儴娓呯悊
- [x] 鍏ㄩ噺 `npm run check:frontend` + `npm run typecheck`锛堝悗绔笉鍙楀奖鍝嶏級

## 5. 鍏抽敭鎶?鏈喅绛?

### 5.1 GSAP
- 鐢? `gsap.context()` + `onMount` 杩斿洖 cleanup锛坄return () => ctx.revert()`锛夈??
- ripple銆佷富棰樿繃娓″姩鐢昏縼绉绘垚鏈綆锛涚畝鍗曡繃娓″彲鐢? Svelte 鍐呯疆 `transition:`銆?

### 5.2 d3 鍥捐〃
- d3 妗嗘灦鏃犲叧锛孲velte 涓洿鎺ュ彲鐢紙鏃犺櫄鎷? DOM 鍐茬獊锛夈??
- 灏佽涓? Svelte 缁勪欢锛坄onMount` 閲屽垵濮嬪寲锛宍$effect` 鍝嶅簲鏁版嵁鍙樺寲锛夈??

### 5.3 i18next
- 鐜版湁 i18next 鍙户缁敤锛岀敤 Svelte store 鎴? `$effect` 鍖呰 `t()`銆?
- 鎴栬瘎浼? `svelte-i18n`锛屼絾浼樺厛淇濈暀 i18next 鍑忓皯鏀瑰姩銆?

### 5.4 鍐呰仈 onclick锛堟渶澶у潙锛?
- index.html 澶ч噺 `onclick="showView(...)"` 渚濊禆鍏ㄥ眬鍑芥暟銆?
- 杩佺Щ鍚庤繖浜涘嚱鏁颁笉鍐嶅叏灞? 鈫? 鏀逛负缁勪欢鍐呬簨浠跺鐞嗘垨 `addEventListener`銆?
- 杩欐槸鍏ㄩ噺杩佺Щ鐨勪富瑕佸伐浣滈噺涔嬩竴銆?

### 5.5 鐘舵?佺鐞?
- 鐜版湁 `state.js` 鍏ㄥ眬鐘舵?? 鈫? Svelte 5 runes锛坄$state`锛夋垨 Svelte store銆?
- 璺ㄨ鍥惧叡浜姸鎬佺敤 store銆?

### 5.6 鏋勫缓
- 绾? Svelte锛堟棤 SvelteKit锛夛紝SPA 妯″紡銆?
- Tauri `frontendDist` 鎸囧悜 `frontend/dist`锛圴ite build 杈撳嚭锛夈??

## 6. 楠岃瘉灞傜骇

| 闃舵 | 鍛戒护 | 閫氳繃鏍囧噯 |
|------|------|---------|
| 鍓嶇鏀瑰姩 | `npm run check:frontend` | JS 璇硶 + CSS token + dist 鏋勫缓鎴愬姛 |
| 鍚庣锛堜笉鍙楀奖鍝嶏級 | `npm run typecheck` | 0 閿欒 |
| 杩愯 | `npm run dev` | dev server 姝ｅ父锛岃鍥惧彲浜や簰 |

## 7. 椋庨櫓涓庣紦瑙?

| 椋庨櫓 | 缂撹В |
|------|------|
| 鍏ㄩ噺杩佺Щ bug 澶? | 鍒嗛樁娈垫墽琛岋紝姣忛樁娈甸獙璇侊紱鐢ㄦ埛鎺ュ彈鎱㈡參淇? |
| 鍐呰仈 onclick 宸ヤ綔閲忓ぇ | Phase 0 闆嗕腑澶勭悊锛屼竴娆℃?ф竻鐞? |
| 鐢熸?佽妯″皬锛堝喎闂ㄩ棶棰橈級 | 浼樺厛鐢ㄥ畼鏂规枃妗? + melt-ui锛涘鏉傜粍浠剁敤绀惧尯搴? |
| d3/i18next 闆嗘垚 | 鍏堥獙璇佸啀鍏ㄩ潰閾哄紑 |
| 杩佺Щ鏈熼棿鍔熻兘鍥炲綊 | 姣忚鍥捐縼绉诲悗璺? check:frontend + 鎵嬪姩楠岃瘉 |

## 8. 瀹屾垚鏍囧噯

- [x] concat 鎻掍欢绉婚櫎锛孷ite + Svelte 鏋勫缓姝ｅ父
- [x] Toast/Modal/Dropdown/Card 涓? Svelte 缁勪欢
- [x] 鎵?鏈夎鍥句负 Svelte 缁勪欢
- [x] 鏃? vanilla JS 鏂囦欢鍒犻櫎
- [x] `npm run check:frontend` 鍏ㄧ豢
- [x] 鍔熻兘涓庤縼绉诲墠涓?鑷达紙GSAP/d3/i18next/鎾斁/鍚屾鍧囨甯革級

// server/__tests__/setup.js
// 测试隔离：把 DATA_DIR 指向临时目录，避免测试写真实 data/ 目录（config.json 等）。
// 通过 package.json 的 --test-setup 注入，在加载任何业务模块前生效。
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myanimedock-test-'));
process.env.MYANIMEDOCK_DATA_DIR = tmpDir;
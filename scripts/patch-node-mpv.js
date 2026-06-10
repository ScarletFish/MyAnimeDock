const fs = require('fs');
const path = require('path');

const files = [
  {
    path: path.join(__dirname, '..', 'node_modules', 'node-mpv', 'lib', 'mpv', 'mpv.js'),
    replacements: [
      // 初始 spawn 加了不该加的引号，与 respawn (line 111) 保持一致
      ['spawn((this.options.binary ? \'"\' + this.options.binary + \'"\' : \'mpv\'), this.mpv_arguments)',
        'spawn((this.options.binary || \'mpv\'), this.mpv_arguments)'],
    ],
  },
  {
    path: path.join(__dirname, '..', 'node_modules', 'node-mpv', 'lib', 'util.js'),
    replacements: [
      ['execSync((options.binary ? \'"\' + options.binary + \'"\' + " --version" : "mpv --version"), {encoding: \'utf8\'})',
        'execSync((options.binary ? options.binary + " --version" : "mpv --version"), {encoding: \'utf8\'})'],
    ],
  },
];

for (const file of files) {
  if (!fs.existsSync(file.path)) {
    console.log('Skipping (not found):', file.path);
    continue;
  }
  let content = fs.readFileSync(file.path, 'utf-8');
  for (const [from, to] of file.replacements) {
    if (!content.includes(from)) {
      console.log('Pattern not found in', file.path);
      continue;
    }
    content = content.replace(from, to);
  }
  fs.writeFileSync(file.path, content, 'utf-8');
  console.log('Patched:', file.path);
}

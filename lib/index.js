const os = require('os');
const Listr = require('listr');
const execa = require('execa');
const pify = require('pify');
const mkdirp = pify(require('mkdirp'));
const fs = pify(require('fs'));
const pMap = require('p-map');

const concurrency = os.cpus().length * 2;

const tasks = new Listr([{
  title: 'brew info --json=v1 --all',
  task: async (ctx) => {
    const res = await execa.stdout('brew', ['info', '--json=v1', '--all']);
    ctx.formulae = JSON.parse(res);
  },
}, {
  title: 'Creating dump directory',
  task: () => mkdirp('dump'),
}, {
  title: 'Dumping JSON files',
  task: ({ formulae }) => pMap(
    formulae,
    formula => fs.writeFile(`dump/${formula.name}.json`, JSON.stringify(formula), 'utf8'),
    { concurrency },
  ),
}]);

tasks.run();

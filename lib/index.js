const os = require('os');
const Listr = require('listr');
const Observable = require('any-observable');
const execa = require('execa');
const pify = require('pify');
const mkdirp = pify(require('mkdirp'));
const fs = pify(require('fs'));
const pMap = require('p-map');

const concurrency = os.cpus().length * 2;

const tasks = new Listr([{
  title: 'Getting info from Homebrew',
  task: ctx => new Observable(async (observer) => {
    observer.next('brew info --json=v1 --all');
    const res = await execa.stdout('brew', ['info', '--json=v1', '--all']);
    ctx.formulae = JSON.parse(res);
    observer.complete();
  }),
}, {
  title: 'Creating dump directory',
  task: () => mkdirp('dump'),
}, {
  title: 'Dumping JSON files',
  task: ({ formulae }) => new Observable(async (observer) => {
    await pMap(
      formulae,
      async (formula) => {
        observer.next(formula.name);
        await fs.writeFile(`dump/${formula.name}.json`, JSON.stringify(formula), 'utf8');
      },
      { concurrency },
    );
    observer.complete();
  }),
}]);

tasks.run();

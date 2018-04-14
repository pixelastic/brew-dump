const os = require('os');
const yargs = require('yargs');
const Listr = require('listr');
const Observable = require('any-observable');
const execa = require('execa');
const pify = require('pify');
const mkdirp = pify(require('mkdirp'));
const fs = pify(require('fs'));
const pMap = require('p-map');

const concurrency = os.cpus().length * 2;

const { argv } = yargs
  .boolean('skip-update')
  .describe('skip-update', 'Skip updating the homebrew registry')
  .boolean('commit')
  .describe('create a commit in CWD tagged with the current timestamp')
  .default('dir', 'dump')
  .describe('dir', 'Specify the output directory')
  .help('h')
  .alias('h', 'help');

const tasks = new Listr([{
  title: 'Updating Homebrew',
  skip: () => argv.skipUpdate,
  task: ctx => new Observable(async (observer) => {
    observer.next('brew update');
    ctx.updated = Date.now();
    await execa('brew', ['update']);
    observer.complete();
  }),
}, {
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
        await fs.writeFile(`${argv.dir}/${formula.name}.json`, JSON.stringify(formula), 'utf8');
      },
      { concurrency },
    );
    observer.complete();
  }),
}, {
  title: 'Committing dump',
  skip: ({ updated }) => {
    if (!argv.commit) return true;
    if (!updated) return 'Must update registry to commit dump';
  },
  task: ({ updated }) => new Observable(async (observer) => {
    observer.next('git add .');
    await execa('git', ['add', '.']);
    observer.next(`git commit -m "dump ${updated}"`);
    await execa('git', ['commit', '-m', `dump ${updated}`])
    observer.next(`git tag dump-${updated}`);
    await execa('git', ['tag', `dump-${updated}`]);
    observer.complete();
  }),
}]);

tasks.run();

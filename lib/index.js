const os = require('os');
const yargs = require('yargs');
const Listr = require('listr');
const Observable = require('any-observable');
const execa = require('execa');
const pify = require('pify');
const mkdirp = pify(require('mkdirp'));
const fs = pify(require('fs'));
const pMap = require('p-map');
const algolia = require('algoliasearch');
const {
  assoc,
  converge,
  identity,
  map,
  prop,
} = require('ramda');

const concurrency = os.cpus().length * 2;

const { argv } = yargs
  .boolean('skip-update')
  .describe('skip-update', 'Skip updating the homebrew registry')
  .boolean('commit')
  .describe('create a commit in CWD tagged with the current timestamp')
  .describe('dir', 'Output JSON files to this directory')
  .describe('algolia', 'Send JSON to the specified Algolia index. Must have ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables set.')
  .help('h')
  .alias('h', 'help');

if (!(argv.dir || argv.algolia)) {
  console.log('Please pass either the --dir or --algolia flags to continue.');
  console.log('Use the -h flag for help.');
  process.exit(-1);
}

const { ALGOLIA_APP_ID, ALGOLIA_API_KEY } = process.env;

if (argv.algolia && !(ALGOLIA_APP_ID && ALGOLIA_API_KEY)) {
  console.log('Please set the ALGOLIA_APP_ID and ALGOLIA_API_KEY environment variables when using the --algolia flag.');
  console.log('Use the -h flag for help.');
  process.exit(-1);
}

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
  skip: () => !argv.dir,
  task: () => mkdirp('dump'),
}, {
  title: 'Dumping JSON files',
  skip: () => !argv.dir,
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
  title: 'Uploading JSON to Algolia',
  skip: () => !argv.algolia,
  task: async ({ formulae }) => {
    const client = algolia(ALGOLIA_APP_ID, ALGOLIA_API_KEY);
    const index = client.initIndex('dev_homebrew');
    await pify(index).addObjects(map(
      converge(assoc('objectID'), [prop('name'), identity]),
      formulae,
    ));
  },
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

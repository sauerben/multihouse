/**
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const lighthouse = require('lighthouse');

const ERROR_LOG = 'error-log.txt';
const VERSION = '1.0 beta';

let numErrors = 0;
let pageIndex = 0;
let runIndex = 0;

let appendOutput = false;
let chromeFlags = ['--headless'];
let inputFile = 'input.csv';
let numRuns = 3;
let outputFile = 'output.csv';
let outputAudits = false;
let outputVitals = false;
const metrics = ['time-to-first-byte', 'first-contentful-paint',
  'largest-contentful-paint', 'speed-index', 'max-potential-fid',
  'first-cpu-idle', 'total-blocking-time', 'cumulative-layout-shift'];
const metadataAudits = [];
let onlyCategories =
  ['performance', 'pwa', 'best-practices', 'accessibility', 'seo'];
let scoreMethod = 'median';

let okToStart = true;

const argv = require('yargs')
  .alias('a', 'append')
  .alias('c', 'categories')
  .alias('f', 'flags')
  .alias('h', 'help')
  .alias('i', 'input')
  .alias('m', 'metadata')
  .alias('o', 'output')
  .alias('t', 'audits')
  .alias('n', 'vitals')
  .alias('r', 'runs')
  .alias('s', 'score-method')
  .describe('a', 'Append output to existing data in output file')
  .describe('c', 'Audits to run: one or more comma-separated values,\n' +
    'default is:\n' + `${onlyCategories.join(',')}`)
  .describe('f', 'One or more comma-separated Chrome flags *without* dashes,\n' +
    `default is ${chromeFlags}`)
  .describe('i', `Input file, default is ${inputFile}`)
  .describe('m', 'Headings for optional page metadata')
  .describe('n', 'Include Web Vitals metrics in audit output')
  .describe('o', `Output file, default is ${outputFile}`)
  .describe('t', `Generate audit scores to output file`)
  .describe('r', 'Number of times Lighthouse audits are run for each URL, ' +
    `default is ${numRuns}`)
  .describe('s', `Method of score aggregation, default is ${scoreMethod}`)
  .help('h')
  .argv;

if (argv.a) {
  appendOutput = true;
}

if (argv.c) {
  const isValid =
    /(performance|pwa|best-practices|accessibility|seo|,)+/.test(argv.c);
  if (isValid) {
    onlyCategories = argv.c.split(',');
    console.log(`Auditing categories: ${onlyCategories}`);
  } else {
    displayError('--c option must be one or more comma-separated values: ' +
      `${argv.c} is not valid`);
    okToStart = false;
  }
}

if (argv.f) {
  chromeFlags = argv.f.split(',').map((flag) => {
    return `--${flag}`;
  });
}

if (argv.i) {
  inputFile = argv.i;
}

// Headings for optional page metadata.
// These will be prepended to the CSV output followed by the audit categories.
// For example:
// Name,Page type,URL,Performance,PWA,Best Practices,Accessibility,SEO
// This line will be followed by a line for each URL successfully audited.
// For example: John Lewis,homepage,https://johnlewis.com, 32, 40, 78, 87, 100
let metadataValues = 'Name,Page type,URL';
if (argv.m) {
  metadataValues = argv.m;
}

if (argv.o) {
  outputFile = argv.o;
}

if (argv.t) {
  outputAudits = true;
}

if (argv.n) {
  outputVitals = true;
}

if (argv.r) {
  const parsedInput = parseInt(argv.r);
  if (parsedInput) {
    numRuns = parsedInput;
  } else {
    displayError(`--r option must be an integer: ${argv.r} is not valid`);
    okToStart = false;
  }
}

if (argv.s) {
  if (/^(average|median)$/.test(argv.s)) {
    scoreMethod = argv.s;
  } else {
    displayError(`--s option must be average or median: ${argv.s} is not valid`);
    okToStart = false;
  }
}

if (argv.v) {
  console.log(`${VERSION}`);
  okToStart = false;
}

const OPTIONS = {
  chromeFlags: chromeFlags,
  // logLevel: 'info'
  onlyCategories: onlyCategories,
};

// If required, delete existing output and error data.
if (!appendOutput) {
  fs.writeFile(outputFile, '', () => {
  //  console.log('Deleted old output data');
  });
}
fs.writeFile(ERROR_LOG, '', () => {
//  console.log('Deleted old error data');
});

// Get page data from CSV file inputFile.
// Each line in inputFile represents a web page, with CSV values for
// page name, page type and page URL.
// For example: John Lewis,homepage,https://johnlewis.com,
// Note that no checks are done on the validity of inputFile or its data.
const inputFileText = fs.readFileSync(inputFile, 'utf8').trim();
const inputData = inputFileText.split('\n');

const data = [];
// okToStart is set to false if the app is being run to get the version number.
if (okToStart) {
  audit(inputData);
}

// First two pageParts are website name and page name.
// URL may contain commas.
function getUrl(page) {
  const pageParts = page.split(',');
  return pageParts.slice(2, pageParts.length).join();
}

// Run a Lighthouse audit for a web page.
// The pages parameter is an array of CSV strings, each ending with a URL.
// For example: John Lewis,homepage,https://johnlewis.com
function audit(pages) {
  console.log(`\nRun ${runIndex + 1} of ${numRuns}: ` +
    `URL ${pageIndex + 1} of ${pages.length}`);
  // page corresponds to a line of data in the CSV file inputFile.
  const page = pages[pageIndex];
  // The page URL is the last item on each line of CSV data.
  const url = getUrl(page);
  launchChromeAndRunLighthouse(url, OPTIONS).then((results) => {
    if (results.runtimeError) {
      displayAndWriteError(`Lighthouse runtime error for ` +
        `${url}.\n\n${results.runtimeError.message}\n`);
    } else {
      // data is an array of objects: metadata and scores for each URL.
      if (!data[pageIndex]) {
        data[pageIndex] = {
          metadata: page,
        };
      }
      // *** Add code here if you want to save complete Lighthouse reports ***
      const categories = Object.values(results.categories);
      for (const category of categories) {
        if (!data[pageIndex].scores) {
          data[pageIndex].scores = {};
        }
        if (!data[pageIndex].scores[category.title]) {
          data[pageIndex].scores[category.title] = [];
        }
        const score = Math.round(category.score * 100);
        if (score === 0) {
          displayAndWriteError(`Zero ${category.title} score for ${url}. ` +
            `This data will be discarded.`);
        } else {
          console.log(`${url}: ${category.title} ${score}`);
          data[pageIndex].scores[category.title].push(score);
        }
      }

      if (outputVitals) {
        console.log('Adding metrics to page test.');
        for (const metric of metrics) {
          if (!data[pageIndex].metrics) {
            data[pageIndex].metrics = {};
          }
          if (!data[pageIndex].metrics[metric]) {
            data[pageIndex].metrics[metric] = [];
          }
          const metricValue = results.audits[metric].numericValue;
          if (metricValue === 0) {
            displayAndWriteError(`Zero ${results.audits[metric].score} score for ${url}.
            This data will be discarded.`);
          } else {
            console.log(`${url}: ${metric} ${metricValue}`);
            data[pageIndex].metrics[metric].push(metricValue);
          }
        }
      }

      if (outputAudits) {
        console.log('Adding audits to output');
        const audits = Object.values(results.audits);
        for (const audit of audits) {
          // Check if metadata for audits not added yet.
          if (metadataAudits.length < audits.length) {
            metadataAudits.push(audit.title);
          }

          if (!data[pageIndex].audits) {
            data[pageIndex].audits = {};
          }
          data[pageIndex].audits[audit.id] = audit.score;
        }
      }
    }
  }).catch((error) => {
    displayAndWriteError(`Caught error for ${url}:\n${error}`);
  }).finally(() => {
    // If there are more pages to audit on this run, begin the next page audit.
    if (++pageIndex < pages.length) {
      audit(pages);
    // Otherwise, if there are more runs to do, begin the next run.
    } else if (++runIndex < numRuns) {
      console.log(`\nStart run ${runIndex + 1}`);
      pageIndex = 0;
      audit(pages);
    // Otherwise, write data to the   t file.
    } else {
      // categories is a list of Lighthouse audits completed.
      // For example: Performance, PWA, Best practices, Accessibility, SEO
      fs.appendFileSync(outputFile, getOutput(data));
      console.log(`\nCompleted ${numRuns} run(s) for ${data.length} URL(s)` +
        `with ${numErrors} error(s).\n\nView output: ${outputFile}\n`);
    }
  });
}

// Launch Chrome, run a Lighthouse audit, then kill Chrome.
// Code is from https://github.com/GoogleChrome/lighthouse
function launchChromeAndRunLighthouse(url, opts, config = null) {
  return chromeLauncher.launch({chromeFlags: opts.chromeFlags}).then((chrome) => {
    opts.port = chrome.port;
    return lighthouse(url, opts, config).then((results) => {
      return chrome.kill().then(() => results.lhr);
    });
  });
}

// The testResults parameter is an array of objects, one for each URL audited.
// Each object has median Lighthouse scores and (optional) metadata.
// This function returns a string in CSV format, each line of which has
// optional metadata followed by median Lighthouse scores for a URL.
// For example: John Lewis,homepage,https://johnlewis.com, 32, 40, 78, 87, 100
function getOutput(testResults) {
  const output = [];
  for (const page of testResults) {
    // console.log(page);
    const pageData = [page.metadata];
    for (const scores of Object.values(page.scores)) {
      // Only options at present are median and average
      pageData.push(scoreMethod === 'median' ?
        median(scores) : average(scores));
    }

    if (outputVitals) {
      for (const metricScores of Object.values(page.metrics)) {
        // Only options at present are median and average
        pageData.push(scoreMethod === 'median' ?
          median(metricScores) : average(metricScores));
      }
    }

    if (outputAudits) {
      for (const audit of Object.values(page.audits)) {
        // Only options at present are median and average
        pageData.push(audit);
      }
    }
    output.push(pageData.join(','));
  }
  // Prepend CSV data with headings and audit categories.
  // For example: Name,Page type,URL,Performance,PWA, Accessibility,SEO
  const categories = Object.keys(data[0].scores).join(',');
  const audits = metadataAudits.join(',');
  if (outputAudits) {
    return `${metadataValues},${categories},${audits}\n${output.join('\n')}`;
  } else if (outputVitals) {
    return `${metadataValues},${categories},${metrics}\n${output.join('\n')}`;
  } else {
    return `${metadataValues},${categories}\n${output.join('\n')}`;
  }
}


// Utility functions

function average(array) {
  const sum = array.reduce((a, b) => a + b);
  return Math.round(sum / array.length);
}

function median(array) {
  array = array.sort((a, b) => a - b);
  if (array.length === 0) {
    return 0;
  }
  const middle = Math.floor(array.length / 2);
  if (array.length % 2) {
    return array[middle];
  } else {
    return (array[middle - 1] + array[middle]) / 2;
  }
}

// Log an error to the console.
function displayError(...args) {
  const color = '\x1b[31m'; // red
  const reset = '\x1b[0m'; // reset color
  console.error(color, '\n>>> Error: ', reset, ...args);
}

// Log an error to the console and write it to the ERROR_LOG file.
function displayAndWriteError(error) {
  numErrors++;
  displayError(`${error}\n`);
  fs.appendFileSync(ERROR_LOG, `Error ${numErrors}: ${error}\n\n`);
}

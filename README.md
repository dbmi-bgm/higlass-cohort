![image](https://github.com/dbmi-bgm/higlass-cohort/assets/53857412/909af584-ef94-4363-a500-f4fccaecdbf0)


# HiGlass plugin track for cohort data

This repository contains two track types (plugin tracks for HiGlass) that can be used to display cohort data. It was developed with case/control cohort data in mind where statistical associacion tests have been performed on a gene and variant level.
The two track types and corresponding options are discussed below.

## Development
Clone the repository and run the `npm install` in the `higlass-cohort` folder. `npm start` will start a local webserver. Open a browser and go to `localhost:8081` to see the `GeneList` and the `CohortTrack` for an example data set.
Changes in the code will be displayed in real time in the browser.

## Usage
These plugin tracks are meant to be used in a React setting. We refer to [this use case](https://github.com/dbmi-bgm/udn-browser/) as an example of how Higlass and associated plugin tracks are used in a React app.


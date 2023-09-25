![image](https://github.com/dbmi-bgm/higlass-cohort/assets/53857412/909af584-ef94-4363-a500-f4fccaecdbf0)


# HiGlass plugin track for cohort data

This repository contains two track types (plugin tracks for HiGlass) that can be used to display cohort data. It was developed with case/control cohort data in mind where statistical associacion tests have been performed on a gene and variant level.
The two track types and corresponding options are discussed below.

## Development
Clone the repository and run the `npm install` in the `higlass-cohort` folder. `npm start` will start a local webserver. Open a browser and go to `localhost:8081` to see the `GeneList` and the `CohortTrack` for an example data set.
Changes in the code will be displayed in real time in the browser.

## Usage
These plugin tracks are meant to be used in a React setting. We refer to [this use case](https://github.com/dbmi-bgm/udn-browser/) as an example of how Higlass and associated plugin tracks are used in a React app.

## GeneList track

The GeneList track displays gene-level information from a VCF file along the genomic coordinate system. The data that is displayed is loaded from the INFO field
of the VCF file. Which values are loaded the VCF and displayed is controlled in the track configuration (example below).

![image](https://github.com/dbmi-bgm/higlass-cohort/assets/53857412/b4081379-1987-4527-ba92-4fd6aafa8a7b)

### VCF format

```
#CHROM  POS     ID      REF     ALT     QUAL    FILTER  INFO
chr1    685716  ENSG00000284662 .       .       0       PASS    END=686654;SYMBOL=OR4F16;go_terms=protein_binding;
chr1    1211340 ENSG00000186827 .       .       0       PASS    END=1214153;SYMBOL=TNFRSF4;DeNovoWEST_pvalue=1.6844194945717081;go_terms=t_cell_proliferation|protein_binding;
chr1    1534778 ENSG00000205090 .       .       0       PASS    END=1540624;SYMBOL=TMEM240;DeNovoWEST_pvalue=2.763844836469083;
```
Minimally required `INFO` fields are `END` and `SYMBOL`. Furthermore, there needs to be a numerical value that can be used as y-axis in the plot. In this example this is `DeNovoWEST_pvalue`. `POS` and `INFO:END` determine the horizontal position and length of the box (i.e. start and end of the gene). `SYMBOL` is the gene identifier, that will be displayed on hover. Other `INFO` fields like `go_terms` can be loaded into the track. These are typcially used as additianal information on hover or click. Note that the first variant does not have a value for `DeNovoWEST_pvalue`. Since in the example below this field be used as y-axis, this variant will not be displayed in the visualization.

### Track configuration
The following is an example track configuration, which assumes that the VCF file contained the data is of the form above
```
{
    "type": "geneList",
    "options": {
      "infoFields":[
        {
          "name": "END",
          "type": "int"
        },
        {
          "name": "SYMBOL",
          "type": "string"
        },
        {
          "name": "go_terms",
          "type": "string_list"
        }
      ],
      "yValue": {
        "field": "DeNovoWEST_pvalue",
      },
      "significanceTreshold": 1.3,
      "yAxisLabel": {
        "visible": true,
        "text": "DeNovoWEST p",
      },
      "project": "UDN",
    },
    "height": 120,
    "uid": "my-gene-track",
    "data": {
      "type": "vcf",
      "vcfUrl": "https://_URL_TO_FILE_/genes.vcf.gz",
      "tbiUrl": "https://_URL_TO_FILE_/genes.vcf.gz.tbi",
      "chromSizesUrl": "https://aveit.s3.amazonaws.com/higlass/data/sequence/hg38.mod.chrom.sizes",
    },
    "width": 450
}
```
We will have a closer look at the track options in the next section. In the track configuration the `type` must be set to `geneList`. The `data` determines the data source. The VCF need to be compress and tabix indexed.

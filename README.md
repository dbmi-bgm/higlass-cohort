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
of the VCF file. Which values are loaded the VCF and displayed is controlled in the track configuration/options (example below).

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
We will have a closer look at the track options in the next section. In the track configuration the `type` must be set to `geneList`. The `data` determines the data source. The VCF need to be compress and tabix indexed. Furthermore, it must be hosted on an accessible webserver.

### Track options

- `project`: If set, valid values are `MSA` and `UDN` currently. It determines what is shown when hovering over a gene and when clicking on a gene. If `project` is not set, we only show the gene name, the symbol and the y-value on hover. Clicking on a gene will have no effect in this case. If you want specific data to be displayed on hover and on click, you will have to extend the `getMouseOverHtml` and `clickDialog` functions. For the click functionality, you will have to implement a React component that is rendered within the model that opens. `GeneDetailsMSA.jsx` and `GeneDetailsUDN.jsx` are examples for this.
- `availableStatistics` (MSA specific option): statistical tests that have been performed and are available in the VCF info field (e.g. `['BURDEN', 'SKAT', 'SKATO', 'ACATV', 'ACATO']`)
- `activeStatistic` (MSA specific option): Test that is currently displayed
- `availableMasks` (MSA specific option): available masks (e.g. `'MASK_MISSENSE', 'MASK_CADD', 'MASK_MISSENSE_CADD', 'MASK_NONSENSE_SPLICE',`)
- `activeMask` (MSA specific option): active mask.
- `includedGenes`: List of genes to display. All other genes won't be shown. E.g. `['ENSG00000186092','ENSG00000188976','ENSG00000131584']`
- `infoFields`: List of all INFO fields to load from the VCF file. These fields can then be displayed in the mouseover of the click modal. See above for an example.
- `filter`: Various filters can be defined to control the genes that are displayed. Each filter has a `field` (info field in the VCF), `operator` and a `target`. The currently supported operators are `is_one_of`, `has_one_of`, `is_between` and `is_equal`. If multiple filters are present we show those genes that satisfy all filters. In the example below, we are only showing those genes whose `DeNovoWEST_pvalue` is between 1.0 and 10.0 and whose `go_terms` include `t_cell_proliferation` or `protein_binding`.
```
"filter": [
{
   "field": "DeNovoWEST_pvalue",
   "operator": "is_between",
   "target": [1.0, 10.0]
},
{
   "field": "go_terms",
   "operator": "has_one_of",
   "target": ["t_cell_proliferation", "protein_binding"]
}]
```
- `yValue`: The info field to use for the vertcal axis.
- `yAxisLabel`: Label for the y-axies. See example above.
- `significanceTreshold`: If `yvalue` is greater than this value, the gene will be marked as `statistically significant`

## Cohort track

The Cohort track displays variant-level information from a VCF file along the genomic coordinate system. The data that is displayed is loaded from the INFO field
of the VCF file. Which values are loaded the VCF and displayed is controlled in the track configuration/options (example below).

![image](https://github.com/dbmi-bgm/higlass-cohort/assets/53857412/bee5906f-3a99-441b-aadb-2a52a6593b09)


### VCF format

The following VCF contains the variants that we want to display
```
#CHROM  POS     ID      REF     ALT     QUAL    FILTER  INFO
chr1    13053   chr1_13053_G_C  G       C       .       PASS    cadd_phred=21.9;cadd_raw=2.358508;gnomADpopmax_AF=0.00118337;most_severe_consequence=splice_donor_variant;level_most_severe_consequence=HIGH;SYMBOL=DDX11L1;gene=ENSG00000223972;transcript=ENST00000450305;cadd_phred=0.059;cadd_raw=-0.640072;
chr1    13054   chr1_13054_C_A  C       A       .       PASS    cadd_phred=16.43;cadd_raw=1.608658;gnomADpopmax_AF=0.000679612;most_severe_consequence=splice_donor_variant;level_most_severe_consequence=HIGH;SYMBOL=DDX11L1;gene=ENSG00000223972;transcript=ENST00000450305;cadd_phred=6.819;cadd_raw=0.530461;
chr1    13453   chr1_13453_T_C  T       C       .       PASS    cadd_phred=12.41;cadd_raw=1.065405;gnomADpopmax_AF=0.000812719;most_severe_consequence=splice_region_variant;level_most_severe_consequence=LOW;SYMBOL=DDX11L1;gene=ENSG00000223972;transcript=ENST00000450305;cadd_phred=4.131;cadd_raw=0.286426;
```
`POS` determines the horizonal position of the variants along the genome. A numeric value from the `INFO` field determines the height of the lollipop. In our example above we are using the `cadd_phred` value. The lollipops in the display can also be color coded. In this case it is determined by the `level_most_severe_consequence` value.

It is important to note, that a VCF of this form will not be compatible with the Cohort track. The track expect a **multiresolution version** of this file to enable genome wide browser without the need to load the entire file into memory. The [Higlass Data](https://github.com/dbmi-bgm/higlass-data) package can be used to create a Cohort track compatible VCF.

### Track configuration
The following is an example track configuration, which assumes that the VCF file contained the data is of the form above
```
{
  "type": "cohort",
    "options": {
      "infoFields":[
        {
          "name": "most_severe_consequence",
          "type": "string"
        },
        {
          "name": "level_most_severe_consequence",
          "type": "string"
        },
        {
          "name": "cadd_raw",
          "type": "float"
        },
        {
          "name": "cadd_phred",
          "type": "float"
        }
      ],
      "yValue": {
        "field": "cadd_phred",
      },
      "colorScale": {
        "field": "level_most_severe_consequence",
        "scale": [
          {
            "value": 'HIGH',
            "color": '#ff0000',
          },
          {
            "value": 'MODERATE',
            "color": '#bf9c00',
          },
          {
            "value": 'LOW',
            "color": '#51abf5',
          },
          {
            "value": 'MODIFIER',
            "color": '#db4dff',
          },
        ]
      },
      "colorScaleLegend": {
        "visible": true,
        "values": ['HIGH', 'MODERATE', 'LOW', 'MODIFIER'],
      },
      "yAxisLabel": {
        "visible": true,
        "text": "CADD Score",
      },
      "project": "UDN",
    },
    "height": 150,
    "uid": "FylkvVBTSumoJ959HT4-5B",
    "data": {
      "type": "vcf",
      "vcfUrl": "https://PATH/variants.multires.vcf.gz",
      "tbiUrl": "https://PATH/variants.multires.vcf.gz.tbi",
      "chromSizesUrl": "https://aveit.s3.amazonaws.com/higlass/data/sequence/hg38.mod.chrom.sizes",
    },
    "width": 450
  }
```
We will have a closer look at the track options in the next section. In the track configuration the `type` must be set to `cohort`. The `data` determines the data source. The VCF need to be compress and tabix indexed. Furthermore, it must be hosted on an accessible webserver.

### Track options

- `project`: See `GeneList` track. If set, valid values are `MSA` and `UDN` currently. It determines what is shown when hovering over a variant and when clicking on a variant. If `project` is not set, we only show a minimal mouseover that includes the variant, position and the y-value. Clicking on a variant will have no effect in this case. If you want specific data to be displayed on hover and on click, you will have to extend the `getMouseOverHtml` and `clickDialog` functions. For the click functionality, you will have to implement a React component that is rendered within the model that opens. `VariantDetailsMSA.jsx` and `VariantDetailsUDN.jsx` are examples for this.
- `colorScale`: See example above. It determines how lollipops are colored based on a categorical value.
- `colorScaleLegend`: See example above. Controls the legend for the color scale. Each value must be present in `colorscale.scale`.
- `infoFields`: As in the `GeneList` track, this determines all `INFO` fields to load from the VCF file.
- `filter`: applies a filter to the currently visible variants. The structure of this option is the same as for the `GeneList` track.
- `yAxisLabel`: Label for the y-axies. See example above.



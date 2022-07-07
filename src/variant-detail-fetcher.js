import { TabixIndexedFile } from '@gmod/tabix';
import VCF from '@gmod/vcf';
import { RemoteFile } from 'generic-filehandle';

class VariantDetailFetcher {
  constructor(dataConfig) {
    this.dataConfig = dataConfig;

    this.vcfFile = new TabixIndexedFile({
      filehandle: new RemoteFile(this.dataConfig.vcfUrl),
      tbiFilehandle: new RemoteFile(this.dataConfig.tbiUrl),
    });

    this.vcfHeader = this.vcfFile.getHeader();
    this.vcfHeader.then((value) => {
      this.tbiVCFParser = new VCF({ header: value });
    });

    
  }

  getVariantDetails(chr, pos) {
    return new Promise((resolve, reject) => {
      const vcfRecords = [];
      this.vcfFile.getLines(chr, pos-1, pos, (line) => {
        const vcfRecord = this.tbiVCFParser.parseLine(line);
        vcfRecords.push(vcfRecord);
      }).then(() => {
        resolve(vcfRecords);
      });
    });
  }

  
}

export default VariantDetailFetcher;

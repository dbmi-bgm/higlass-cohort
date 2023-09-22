import React from 'react';
//import PropTypes from 'prop-types';
import { format } from 'd3-format';


class VariantDetailsUDN extends React.Component {
  constructor(props) {
    super(props);

    this.dataFetcher = props.dataFetcher;
    this.chr = props.chr;
    this.pos = props.pos;
    this.variantInfo = props.variantInfo;

    this.state = {
      loading: true,
      variantNotFound: false,
      affectedIndividuals: null,
    };

    this.loadData();
  }

  loadData() {
    if(this.dataFetcher){
      this.dataFetcher.getVariantDetails(this.chr, this.pos).then((records) => {
        if (!records.length) {
          this.setState({ loading: false, variantNotFound: true });
        }
        this.setState({ loading: false, affectedIndividuals: records[0] });
      });
    }
    
  }

  formatFloat(num) {
    if(!num){
      return "-"
    }
    return num !== null ? format('.2f')(num) : '-';
  }

  formatString(str) {
    return str ? str : '-';
  }

  formatGoTerms(str) {
    return str ? str.split("|") : [];
  }

  render() {
    
    let sampleInfoTable = <div></div>;
    if(!this.dataFetcher){
      sampleInfoTable = <div></div>;;
    } else if (this.state.loading) {
      sampleInfoTable = <div className="text-center">Loading...</div>;
    } else if (this.state.variantNotFound) {
      sampleInfoTable = (
        <div className="text-center">No data found for this variant</div>
      );
    } else if (!this.state.affectedIndividuals) {
      sampleInfoTable = (
        <div className="text-center">Variant details are not available</div>
      );
    } else {
      let samples = this.state.affectedIndividuals['INFO']['samples'];
      const sampleInfoTableRows = [];

      samples.forEach((sample) => {
        if(sample === ""){
          return;
        }
        const sample_ = sample.split(":");
        const sampleId = sample_[0];
        const hpoTerms = sample_[1];
        const afftectedStatus = sample_[2];
        const genotype = sample_[3];

        const hpoTermsDiv = [];
        const hpoTerms_ = hpoTerms.split("|").sort();
        hpoTerms_.forEach((hpoTerm) => {
          hpoTermsDiv.push(
            <div>{hpoTerm}</div>
          );
        })
        
        sampleInfoTableRows.push(
          <tr>
            <td className="text-break">{sampleId}</td>
            <td className="">{hpoTermsDiv}</td>
            <td className="text-center">{afftectedStatus}</td>
            <td className="text-center">{genotype}</td>
          </tr>
        )
      });
      sampleInfoTable = 
        <table className="table table-sm table-hover text-left bg-light">
          <thead>
            <tr>
              <th>UDN ID</th>
              <th>HPO terms</th>
              <th>Affected Status</th>
              <th>Genotype</th>
            </tr>
          </thead>
          <tbody>{sampleInfoTableRows}</tbody>
        </table>;
    }

    const chr = this.variantInfo.chrName;
    const pos = this.variantInfo.from - this.variantInfo.chrOffset;
    let vRef = this.variantInfo.ref.match(/.{1,15}/g).join('<br>');
    let vAlt = this.variantInfo.alt.match(/.{1,15}/g).join('<br>');
    let goTerms = this.formatGoTerms(this.variantInfo.go_terms);
    let goTermsDiv = "-";
    if(goTerms.length>0){
      goTermsDiv = [];
      goTerms.forEach(goTerm => {
        goTermsDiv.push(<li>{goTerm.replaceAll("_", " ")}</li>)
      });
      goTermsDiv = <ul>{goTermsDiv}</ul>;
    }

    let keggCategories = this.variantInfo.kegg_category;
    let keggCategoryDiv = "-";
    if(keggCategories.length>0){
      keggCategoryDiv = [];
      keggCategories.forEach(cat => {
        keggCategoryDiv.push(<li>{cat.replaceAll("_", " ")}</li>)
      });
      keggCategoryDiv = <ul>{keggCategoryDiv}</ul>;
    }

    return (
      <div>
        <div className="pt-2 pb-1">Variant details</div>
        <table className="table table-sm table-hover text-left bg-light">
          <tbody>
            <tr>
              <td>Position</td>
              <td>{chr}:{format(",")(pos)}({vRef} &rarr; {vAlt})</td>
            </tr>
            <tr>
              <td>Most severe consequence</td>
              <td>{this.variantInfo.most_severe_consequence} ({this.variantInfo.level_most_severe_consequence})</td>
            </tr>
            <tr>
              <td>Gene</td>
              <td>{this.variantInfo.gene} ({this.variantInfo.SYMBOL})</td>
            </tr>
            <tr>
              <td>Transcript</td>
              <td>{this.variantInfo.transcript}</td>
            </tr>
            <tr>
              <td>Protein</td>
              <td>{this.variantInfo.protein ? this.variantInfo.protein : "-"}</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Occurrences</div>
        <table className="table table-sm table-hover text-left bg-light">
          <thead>
            <tr>
              <th></th>
              <th>Cases</th>
              <th>Control</th>
              <th>gnomAD popmax</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Allele Frequency</td>
              <td>{format('.2%')(this.variantInfo.case_AF)}</td>
              <td>{format('.2%')(this.variantInfo.control_AF)}</td>
              <td>{format('.2e')(this.variantInfo.gnomADpopmax_AF)}</td>
            </tr>
            <tr>
              <td>Allele Count</td>
              <td>{format(',')(this.variantInfo.case_AC)}</td>
              <td>{format(',')(this.variantInfo.control_AC)}</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td>Allele Number</td>
              <td>{format(',')(this.variantInfo.case_AN)}</td>
              <td>{format(',')(this.variantInfo.control_AN)}</td>
              <td>&mdash;</td>
            </tr>
          </tbody>
        </table>


        <div className="pt-2 pb-1">Annotations</div>
        <table className="table table-sm table-hover text-left bg-light">
          <tbody>
            <tr>
              <td>CADD score (raw)</td>
              <td>{this.formatFloat(this.variantInfo.cadd_raw)}</td>
            </tr>
            <tr>
              <td>CADD score (scaled)</td>
              <td>{this.formatFloat(this.variantInfo.cadd_phred)}</td>
            </tr>
            <tr>
              <td>SpliceAI (Acceptor Loss)</td>
              <td>{this.formatFloat(this.variantInfo.spliceai_al)}</td>
            </tr>
            <tr>
              <td>SpliceAI (Donor Loss)</td>
              <td>{this.formatFloat(this.variantInfo.spliceai_dl)}</td>
            </tr>
            <tr>
              <td>SpliceAI (Acceptor Gain)</td>
              <td>{this.formatFloat(this.variantInfo.spliceai_ag)}</td>
            </tr>
            <tr>
              <td>SpliceAI (Donor Gain)</td>
              <td>{this.formatFloat(this.variantInfo.spliceai_dg)}</td>
            </tr>
            <tr>
              <td>cDNA change</td>
              <td>{this.formatString(this.variantInfo.cdna_change)}</td>
            </tr>
            <tr>
              <td>Protein change</td>
              <td>{this.formatString(this.variantInfo.prot_change)}</td>
            </tr>
            <tr>
              <td>Clinvar Allele ID</td>
              <td>{this.formatString(this.variantInfo.clinvar_alleleid)}</td>
            </tr>
            <tr>
              <td>GO terms</td>
              <td>{goTermsDiv}</td>
            </tr>
            <tr>
              <td>KEGG Category</td>
              <td>{keggCategoryDiv}</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Samples with this variant</div>
        {sampleInfoTable}
      </div>
    );
  }
}

VariantDetailsUDN.defaultProps = {
  //position: 'top',
};

VariantDetailsUDN.propTypes = {};

export default VariantDetailsUDN;

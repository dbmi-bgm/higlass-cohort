import React from 'react';
//import PropTypes from 'prop-types';
import { format } from 'd3-format';


class VariantDetailsMSA extends React.Component {
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
      dataFetcherFound: this.dataFetcher ? true : false
    };

    if(this.dataFetcher){
      this.loadData();
    }
    
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
    return num !== null ? format('.2f')(num) : '-';
  }

  formatString(str) {
    return str ? str : '-';
  }

  render() {
    
    let sampleInfoTable = <div></div>;
    if(!this.state.dataFetcherFound){
      sampleInfoTable = (
        <div className="mt-2"><i>Sample level information is not available</i></div>
      );
    }else if (this.state.loading) {
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
      const samples = this.state.affectedIndividuals['INFO']['samples'];
      const sampleInfoTableRows = [];

      samples.forEach((sample) => {
        if(sample === ""){
          return;
        }
        const sample_ = sample.split(":");
        const sampleId = sample_[0];
        const linktoId = sample_[1];
        const caseOrControl = sample_[2] === "True" ? "Case": "Control";
        const tissueType = sample_[3] === "" ? "NA" : sample_[3];
        const contactHtml = sample_[4] === "" ? "" : <a href={"mailto:"+sample_[4]}>&#9993;</a>;
        
        sampleInfoTableRows.push(
          <tr>
            <td className="text-break"><a href={linktoId} target="_blank">{sampleId}</a></td>
            <td className="text-center">{caseOrControl}</td>
            <td className="text-center">{tissueType}</td>
            <td className="text-center">{contactHtml}</td>
          </tr>
        )
      });
      sampleInfoTable = 
        <table className="table table-sm table-hover text-left bg-light">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Case/Control</th>
              <th>Tissue type</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>{sampleInfoTableRows}</tbody>
        </table>;
    }

    const chr = this.variantInfo.chrName;
    const pos = this.variantInfo.from - this.variantInfo.chrOffset;
    let vRef = this.variantInfo.ref.match(/.{1,15}/g).join('<br>');
    let vAlt = this.variantInfo.alt.match(/.{1,15}/g).join('<br>');

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
              <td>Worst transcript</td>
              <td>{this.variantInfo.transcript}</td>
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
              <th>gnomAD v2</th>
              <th>gnomAD v3</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Allele Frequency</td>
              <td>{format('.2%')(this.variantInfo.case_AF)}</td>
              <td>{format('.2%')(this.variantInfo.control_AF)}</td>
              <td>{format('.2%')(this.variantInfo.gnomADe2_AF)}</td>
              <td>{format('.2%')(this.variantInfo.gnomADg_AF)}</td>
            </tr>
            <tr>
              <td>Allele Count</td>
              <td>{format(',')(this.variantInfo.case_AC)}</td>
              <td>{format(',')(this.variantInfo.control_AC)}</td>
              <td>{format(',')(this.variantInfo.gnomADe2_AC)}</td>
              <td>{format(',')(this.variantInfo.gnomADg_AC)}</td>
            </tr>
            <tr>
              <td>Allele Number</td>
              <td>{format(',')(this.variantInfo.case_AN)}</td>
              <td>{format(',')(this.variantInfo.control_AN)}</td>
              <td>{format(',')(this.variantInfo.gnomADe2_AN)}</td>
              <td>{format(',')(this.variantInfo.gnomADg_AN)}</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Variant association test statistics</div>
        <table className="table table-sm table-hover text-left bg-light">
          <thead>
            <tr>
              <th></th>
              <th>
                Fisher exact test <br /> p-value (-log10)
              </th>
              <th>
                Fisher exact test <br /> odds ratio
              </th>
              <th>
                Regenie score test <br /> p-value (-log10)
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cases / Control</td>
              <td>{this.formatFloat(this.variantInfo.fisher_ml10p_control)}</td>
              <td>{this.formatFloat(this.variantInfo.fisher_or_control)}</td>
              <td>{this.formatFloat(this.variantInfo.regenie_ml10p)}</td>
            </tr>
            <tr>
              <td>Cases / gnomAD v2</td>
              <td>
                {this.formatFloat(this.variantInfo.fisher_ml10p_gnomADe2)}
              </td>
              <td>{this.formatFloat(this.variantInfo.fisher_or_gnomADe2)}</td>
              <td>-</td>
            </tr>
            <tr>
              <td>Cases / gnomAD v3</td>
              <td>{this.formatFloat(this.variantInfo.fisher_ml10p_gnomADg)}</td>
              <td>{this.formatFloat(this.variantInfo.fisher_or_gnomADg)}</td>
              <td>-</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Predictors</div>
        <table className="table table-sm table-hover text-left bg-light">
          <thead>
            <tr>
              <th>Prediction tool</th>
              <th>Score</th>
              <th>Prediction</th>
              <th>Rank Score (0 to 1)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GERP++</td>
              <td>{this.formatFloat(this.variantInfo.gerp_score)}</td>
              <td>-</td>
              <td>{this.formatFloat(this.variantInfo.gerp_rankscore)}</td>
            </tr>
            <tr>
              <td>CADD</td>
              <td>{this.formatFloat(this.variantInfo.cadd_phred)}</td>
              <td>-</td>
              <td>{this.formatFloat(this.variantInfo.cadd_raw_rs)}</td>
            </tr>

            <tr>
              <td>SIFT</td>
              <td>{this.formatFloat(this.variantInfo.sift_score)}</td>
              <td>{this.formatString(this.variantInfo.sift_pred)}</td>
              <td>{this.formatFloat(this.variantInfo.sift_rankscore)}</td>
            </tr>
            <tr>
              <td>PolyPhen2</td>
              <td>{this.formatFloat(this.variantInfo.polyphen_score)}</td>
              <td>{this.formatString(this.variantInfo.polyphen_pred)}</td>
              <td>{this.formatFloat(this.variantInfo.polyphen_rankscore)}</td>
            </tr>

            <tr>
              <td>SpliceAI</td>
              <td>{this.formatFloat(this.variantInfo.spliceai_score_max)}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Samples with this variant</div>
        {sampleInfoTable}
      </div>
    );
  }
}

VariantDetailsMSA.defaultProps = {
  //position: 'top',
};

VariantDetailsMSA.propTypes = {};

export default VariantDetailsMSA;

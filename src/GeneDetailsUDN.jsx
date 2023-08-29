import React from 'react';
//import PropTypes from 'prop-types';
import { getMasksPerSnp } from './misc-utils';
import { format } from 'd3-format';

class GeneDetailsUDN extends React.Component {
  constructor(props) {
    super(props);

    this.segment = props.segment;
    this.trackOptions = props.trackOptions;

    this.state = {
      loading: false,
    };
  }

  render() {
    const deNovoWest = this.segment['DeNovoWEST_pvalue'] !== null
      ? format('.4f')(this.segment['DeNovoWEST_pvalue'])
      : '-';
    const biallelic = this.segment['biallelic_pvalue']  !== null
      ? format('.4f')(this.segment['biallelic_pvalue'])
      : '-';

    const keggs = [];
    this.segment['kegg_category'].forEach(c => {
      keggs.push(<li key={c}>{c.replaceAll("_", " ")}</li>)
    })

    const goTerms = [];
    this.segment['go_terms'].forEach(c => {
      goTerms.push(<li key={c}>{c.replaceAll("_", " ")}</li>)
    })

    return (
      <div>
        <div className="py-2">Gene-based association test results</div>
        <table className="table table-sm table-hover text-left">
          <thead>
            <tr>
              <th>Statistical test</th>
              <th>p-value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>DeNovoWEST</td>
              <td>{deNovoWest}</td>
            </tr>
            <tr>
              <td>Biallelic</td>
              <td>{biallelic}</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-2 pb-1">Annotations</div>
        <table className="table table-sm table-hover text-left">
          <tbody>
            <tr>
              <td>KEGG category</td>
              <td><ul>{keggs}</ul></td>
            </tr>
            <tr>
              <td>GO terms</td>
              <td><ul>{goTerms}</ul></td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
}

GeneDetailsUDN.defaultProps = {
  //position: 'top',
};

GeneDetailsUDN.propTypes = {};

export default GeneDetailsUDN;

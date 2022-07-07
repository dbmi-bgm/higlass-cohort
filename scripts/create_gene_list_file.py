import click
import vcf
import pandas as pd
import copy
import negspy.coordinates as nc

TILE_SIZE = 1024  # Higlass tile size for 1D tracks
MAX_ZOOM_LEVEL = 23

class MultiResVcf:

    input_filepath = ""
    output_filepath = ""
    output_bw_filepath = ""
    max_variants_per_tile = 0
    chromosomes = []
    variants = []
    variants_multires = []
    variants_df = []
    variants_by_id = {}
    tile_sizes = []
    chrom_info = ""
    quiet = True

    def __init__(
        self,
        input_filepath,
        output_filepath,
        max_variants_per_tile,
        importance_column,
        quiet,
    ):
        self.input_filepath = input_filepath
        self.output_filepath = output_filepath
        self.max_variants_per_tile = max_variants_per_tile
        self.importance_column = importance_column
        self.quiet = quiet
        self.variants = self.load_variants()
        self.chromosomes = self.get_chromosomes()
        self.tile_sizes = [TILE_SIZE * (2**i) for i in range(0, MAX_ZOOM_LEVEL)]
        self.chrom_info = nc.get_chrominfo("hg38")

    def create_multires_vcf(self):
        self.assign_ids()
        self.index_variants_by_id()
        self.create_variants_dataframe()
        self.aggregate()
        self.write_vcf()

    def aggregate(self):

        if not self.quiet:
            print("Start aggregation")

        for zoom_level, tile_size in enumerate(self.tile_sizes):
            if not self.quiet:
                print("  Current zoom level: ", zoom_level, ". Tile size: ", tile_size)

            # Don't do any aggregation, just copy the values with modified chr
            if zoom_level == 0:
                for id in self.variants_by_id:
                    variant = self.variants_by_id[id]  # Retrieve original data
                    variant_copy = copy.copy(variant)
                    if variant_copy.CHROM in self.chromosomes:
                        variant_copy.CHROM = variant_copy.CHROM + "_" + str(zoom_level)
                        self.variants_multires.append(variant_copy)
                continue

            current_pos = 0
            current_index = 0
            last_pos = self.variants_df["absPos"].iloc[-1]

            while current_pos < last_pos:
                current_index = current_index + 1
                new_pos = tile_size * current_index
                variant_in_bin_ids = []

                variants_in_bin = self.variants_df[
                    (self.variants_df.absPos >= current_pos)
                    & (self.variants_df.absPos < new_pos)
                ]
                num_variants_in_bin = len(variants_in_bin.index)
                current_pos = new_pos
                if num_variants_in_bin == 0:
                    continue

                #print(variants_in_bin)

                if num_variants_in_bin > self.max_variants_per_tile:
                    if not self.quiet:
                        print(
                            f"    Removing {num_variants_in_bin - self.max_variants_per_tile} variants from bin {tile_size * (current_index - 1)} - {new_pos} ({num_variants_in_bin} total variants)"
                        )
                    variants_in_bin = variants_in_bin.sort_values(
                        by=["importance"], ascending=[True]
                    )[: self.max_variants_per_tile]

                variant_in_bin_ids += list(variants_in_bin.iloc[:, 1])

                variant_in_bin_ids.sort()
                for id in variant_in_bin_ids:
                    variant = self.variants_by_id[id]  # Retrieve original data
                    variant_copy = copy.copy(variant)
                    if variant_copy.CHROM in self.chromosomes:
                        variant_copy.CHROM = variant_copy.CHROM + "_" + str(zoom_level)
                        self.variants_multires.append(variant_copy)

    def load_variants(self):
        if not self.quiet:
            print("Loading variants...")
        variants = []
        vcf_reader = vcf.Reader(open(self.input_filepath, "r"))

        for record in vcf_reader:
            variants.append(record)

        if not self.quiet:
            print("Loading variants complete.")
        return variants

    def index_variants_by_id(self):
        for variant in self.variants:
            self.variants_by_id[variant.ID] = variant

    # Create a matrix of the data that we use for filtering
    def create_variants_dataframe(self):
        chromosomes = []
        ids = []
        pos = []
        absPos = []
        importance = []

        if not self.quiet:
            print("Creating data frame for easy querying during aggregation.")

        for variant in self.variants:

            chromosomes.append(variant.CHROM)
            ids.append(variant.ID)
            pos.append(variant.POS)
            absPos.append(
                nc.chr_pos_to_genome_pos(variant.CHROM, variant.POS, self.chrom_info)
            )
            importance_value = variant.INFO[self.importance_column][0]
            importance.append(importance_value)

        d = {
            "chr": chromosomes,
            "id": ids,
            "pos": pos,
            "absPos": absPos,
            "importance": importance,
        }
        self.variants_df = pd.DataFrame(data=d)

    def write_vcf(self):
        vcf_reader = vcf.Reader(open(self.input_filepath, "r"))

        with open(self.output_filepath, "w") as output:
            vcf_writer = vcf.Writer(output, vcf_reader)

            for variant in self.variants_multires:
                vcf_writer.write_record(variant)
                vcf_writer.flush()

    def get_chromosomes(self):
        if not self.quiet:
            print("Extracting chromosomes...")
        chrs = list(set(map(lambda v: v.CHROM, self.variants)))
        if "chrM" in chrs:
            chrs.remove("chrM")
        chrs.sort()
        if not self.quiet:
            print("Chromosomes used: ", chrs)
        return chrs

    def assign_ids(self):
        id = 0
        for variant in self.variants:
            variant.ID = id
            id = id + 1

  
@click.command()
@click.help_option("--help", "-h")
@click.option("-i", "--input-vcf", required=True, type=str)
@click.option("-o", "--output-vcf", required=False, type=str)
@click.option("-s", "--importance-col", required=True, type=str) # column in info field
@click.option(
    "-m", "--max-tile-values", default=2000, required=False, type=int
)
@click.option("-q", "--quiet", required=False, default=True, type=bool)
# @click.option('-z', '--min-zoom-level', required=False, type=int)
def create_gene_list_file(
    input_vcf, output_vcf, max_tile_values, importance_col, quiet
):
    input_filepath = input_vcf
    output_vcf_filepath = output_vcf
    max_variants_per_tile = max_tile_values
    importance_column = importance_col

    mrv = MultiResVcf(
        input_filepath,
        output_vcf_filepath,
        max_variants_per_tile,
        importance_column,
        quiet,
    )
    if output_vcf_filepath:
        mrv.create_multires_vcf()


#
if __name__ == "__main__":
    """
    Example:
    python create_gene_list_file.py -i cohort_gene_info.vcf -o cohort_gene_info.multires.vcf -s CMC
    """
    create_gene_list_file()

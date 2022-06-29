import click
import vcf
import pandas as pd
import copy
import negspy.coordinates as nc

TILE_SIZE = 1024  # Higlass tile size for 1D tracks
MAX_ZOOM_LEVEL = 23
CONSEQUENCE_LEVELS = ["HIGH", "LOW", "MODERATE", "MODIFIER"]


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
        output_bw_filepath,
        max_variants_per_tile,
        quiet,
    ):
        self.input_filepath = input_filepath
        self.output_filepath = output_filepath
        self.output_bw_filepath = output_bw_filepath
        self.max_variants_per_tile = max_variants_per_tile
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

                for consequence in CONSEQUENCE_LEVELS:
                    variants_per_consequence = variants_in_bin[
                        (variants_in_bin.consequence == consequence)
                    ]
                    num_variants_per_consequence = len(variants_per_consequence.index)

                    if num_variants_per_consequence > self.max_variants_per_tile:
                        if not self.quiet:
                            print(
                                f"    Removing {num_variants_per_consequence - self.max_variants_per_tile} {consequence} variants from bin {tile_size * (current_index - 1)} - {new_pos} ({num_variants_in_bin} total variants)"
                            )
                        variants_per_consequence = variants_per_consequence.sort_values(
                            by=["importance"], ascending=[False]
                        )[: self.max_variants_per_tile]

                    variant_in_bin_ids += list(variants_per_consequence.iloc[:, 1])

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

    def importance(self, fisher_score, consequence):
        # We are treating each consequence level separately, therefore we are just returning the Fisher score here
        return fisher_score

        # Calculate an imporance values based on Fisher score and most severe consequence
        consequence_multiplier = 0.7

        if consequence == "HIGH":
            consequence_multiplier = 1.0
        elif consequence == "MODERATE":
            consequence_multiplier = 0.9
        elif consequence == "LOW":
            consequence_multiplier = 0.8
        elif consequence == "MODIFIER":
            consequence_multiplier = 0.7

        # We are capping the Fisher score at 20 for the importance calculation, larger values might not be more important
        return min(fisher_score, 20) * consequence_multiplier

    # Create a matrix of the data that we use for filtering
    def create_variants_dataframe(self):
        chromosomes = []
        ids = []
        pos = []
        absPos = []
        fisher = []
        importance = []
        consequence = []

        if not self.quiet:
            print("Creating data frame for easy querying during aggregation.")

        for variant in self.variants:

            chromosomes.append(variant.CHROM)
            ids.append(variant.ID)
            pos.append(variant.POS)
            absPos.append(
                nc.chr_pos_to_genome_pos(variant.CHROM, variant.POS, self.chrom_info)
            )
            fisher_score = variant.INFO["fisher_gnomADv3_minuslog10p"][0]
            if fisher_score == "NA":
                fisher_score = 0.0
            fisher_score = float(fisher_score)
            conseq = variant.INFO["level_most_severe_consequence"][0]

            if conseq not in CONSEQUENCE_LEVELS:
                print(f"Warning: Consequence level {conseq} not expected.")
            consequence.append(conseq)

            fisher.append(fisher_score)
            importance.append(self.importance(fisher_score, consequence))

        d = {
            "chr": chromosomes,
            "id": ids,
            "pos": pos,
            "absPos": absPos,
            "fisher": fisher,
            "consequence": consequence,
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

    def create_coverage_bw(self):
        self.create_variants_dataframe()

        with open(self.output_bw_filepath, "w") as output:

            for chr in self.chromosomes:
                current_pos = 0
                current_index = 0
                chr_variants = self.variants_df[self.variants_df.chr == chr]
                last_pos = chr_variants["pos"].iloc[-1]
                while current_pos < last_pos:
                    new_index = current_index + 1
                    new_pos = TILE_SIZE * new_index
                    variants_in_bin = chr_variants[
                        (chr_variants.pos >= current_pos) & (chr_variants.pos < new_pos)
                    ]
                    num_variants_in_bin = len(variants_in_bin.index)
                    line = "%s\t%s\t%s\t%s\n" % (
                        chr,
                        current_pos,
                        new_pos,
                        num_variants_in_bin,
                    )
                    output.write(line)
                    current_index = new_index
                    current_pos = new_pos

    # Currently unused. The idea was to not repeat variants on low zoom levels, if there is o aggregation.
    # This would have needed to be handled by the Higlass Cohort track accordingly. It's too complicated
    # and not worth it for now.
    def get_min_zoom_level(self):

        print("Calculating minimal zoom level")

        for zoom_level, tile_size in enumerate(self.tile_sizes):
            print("Checking zoom level", zoom_level, "with tile size", tile_size)
            current_pos = 0
            current_index = 0
            total_variants = 0

            for chr in self.chromosomes:
                chr_variants = self.variants_df[self.variants_df.chr == chr]
                last_pos = chr_variants["pos"].iloc[-1]
                while current_pos < last_pos:
                    new_index = current_index + 1
                    new_pos = tile_size * new_index
                    variants_in_bin = chr_variants[
                        (chr_variants.pos >= current_pos) & (chr_variants.pos < new_pos)
                    ]
                    num_variants_in_bin = len(variants_in_bin.index)
                    total_variants = total_variants + num_variants_in_bin
                    # if current_index % 1 == 0:
                    #     print(tile_size, current_pos, new_pos, num_variants_in_bin, total_variants)

                    if num_variants_in_bin > self.max_variants_per_tile:
                        print(
                            "Minimal zoom level found. Bin",
                            current_pos,
                            "-",
                            new_pos,
                            "has",
                            num_variants_in_bin,
                            "variants",
                        )
                        print(variants_in_bin)
                        self.min_zoom_level = max(0, zoom_level - 1)
                        return

                    current_index = new_index
                    current_pos = new_pos
                print("-- chromosome", chr, "done")


@click.command()
@click.help_option("--help", "-h")
@click.option("-i", "--input-vcf", required=True, type=str)
@click.option("-o", "--output-vcf", required=False, type=str)
@click.option("-b", "--output-bw", required=False, type=str)
@click.option(
    "-m", "--max-tile-values-per-consequence", default=50, required=False, type=int
)
@click.option("-q", "--quiet", required=False, default=True, type=bool)
# @click.option('-z', '--min-zoom-level', required=False, type=int)
def create_higlass_files(
    input_vcf, output_vcf, output_bw, max_tile_values_per_consequence, quiet
):
    input_filepath = input_vcf
    output_vcf_filepath = output_vcf
    output_bw_filepath = output_bw
    max_variants_per_tile = max_tile_values_per_consequence

    mrv = MultiResVcf(
        input_filepath,
        output_vcf_filepath,
        output_bw_filepath,
        max_variants_per_tile,
        quiet,
    )
    if output_vcf_filepath:
        mrv.create_multires_vcf()

    if output_bw_filepath:
        mrv.create_coverage_bw()
        # This will create a bed file. Run the following to convert to a bigwig
        # sort -k1,1 -k2,2n temp.bed > temp.sorted.bed
        # bedgraphtobigwig temp.bed hg38.txt out.bw


#
if __name__ == "__main__":
    """
    Example:
    python create_higlass_files.py -i joint_calling_results.vcf -o joint_calling_results_higlass.vcf -b joint_calling_results_coverage.vcf
    """
    create_higlass_files()

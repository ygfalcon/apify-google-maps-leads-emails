// Platform unit prices for a paying user on the free/starter tier.
// https://docs.apify.com/platform/actors/publishing/monetize/pricing-and-costs
// Compute is 1 CU = 1 GB-hour. Datacenter proxy is billed per IP, not per GB, so it is not included here.
const CU_USD = 0.2;
const TRANSFER_USD_PER_GB = 0.2;
const DATASET_WRITE_USD_PER_THOUSAND = 0.005;

export function estimatePerThousand({
    places,
    wallMs,
    detailBytes = 0,
    contactBytes = 0,
    memoryGb = 1,
}) {
    const scale = places > 0 ? 1000 / places : 0;
    const wallSec = (wallMs / 1000) * scale;
    const computeUsd = memoryGb * (wallSec / 3600) * CU_USD;
    const transferGb = ((detailBytes + contactBytes) * scale) / 1e9;
    const transferUsd = transferGb * TRANSFER_USD_PER_GB;
    const datasetWriteUsd = DATASET_WRITE_USD_PER_THOUSAND;
    const totalUsd = computeUsd + transferUsd + datasetWriteUsd;
    return {
        places: 1000,
        extrapolatedFrom: places,
        wallSec: round(wallSec),
        computeUsd: round(computeUsd),
        transferGb: round(transferGb),
        transferUsd: round(transferUsd),
        datasetWriteUsd,
        totalUsd: round(totalUsd),
        cuUsd: CU_USD,
        transferUsdPerGb: TRANSFER_USD_PER_GB,
    };
}

function round(n) {
    return Math.round(n * 10000) / 10000;
}

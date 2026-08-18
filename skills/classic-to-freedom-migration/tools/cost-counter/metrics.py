"""Weighted-cost configuration and the two core cost computations.

The weights are Anthropic list-price ratios normalised to the input token
(input = 1). They are *configuration*, printed in every report and never
silently baked into a result: changing a price must not force a run to be
re-measured (ENG-95467 R3).

Cache-write is not a single price. A 5-minute ephemeral write is billed at
1.25x the input rate, a 1-hour write at 2.0x. The summed
``cache_creation_input_tokens`` usage field hides which is which, so the
effective cache-write weight is the volume-weighted blend of the two TTL
buckets read from ``usage.cache_creation.ephemeral_*`` (R4).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CostConfig:
    """Price ratios relative to one input token (model-tier independent)."""

    input_weight: float = 1.0
    cache_read_weight: float = 0.1
    output_weight: float = 5.0
    # Cache-write is priced by TTL bucket; the effective weight applied to a
    # run is the volume-weighted blend of these two -- see
    # effective_cache_write_weight().
    cache_write_5m_weight: float = 1.25
    cache_write_1h_weight: float = 2.0

    def as_lines(self, effective_w: float | None = None) -> list[str]:
        """Human-readable config block printed at the top of every report."""
        lines = [
            "weighted-cost config  (Anthropic list-price ratios, relative to 1 input token,",
            "                       model-tier independent -- change here, never in code paths):",
            f"    input        x {self.input_weight:>5.2f}",
            f"    cache_read   x {self.cache_read_weight:>5.2f}",
            f"    output       x {self.output_weight:>5.2f}",
            f"    cache_write  x TTL blend of "
            f"5m={self.cache_write_5m_weight:.2f} / 1h={self.cache_write_1h_weight:.2f}",
        ]
        if effective_w is not None:
            lines.append(f"    -> effective cache_write weight for this run: {effective_w:.3f}")
        return lines


def effective_cache_write_weight(
    ephemeral_5m: float, ephemeral_1h: float, cfg: CostConfig = CostConfig()
) -> float:
    """Volume-weighted blend of the two cache-write TTL prices (R4).

    ``w = (tok5m*1.25 + tok1h*2.0) / (tok5m + tok1h)``. Returns 0.0 when there
    is no cache-write volume at all.
    """
    total = ephemeral_5m + ephemeral_1h
    if total <= 0:
        return 0.0
    return (
        ephemeral_5m * cfg.cache_write_5m_weight
        + ephemeral_1h * cfg.cache_write_1h_weight
    ) / total


def weighted_cost(
    input_tokens: float,
    cache_write: float,
    cache_read: float,
    output: float,
    cache_write_weight: float,
    cfg: CostConfig = CostConfig(),
) -> float:
    """Weighted cost in input-equivalent tokens (R3).

    ``cost = input + w*cache_write + 0.1*cache_read + 5*output``
    where ``w`` is the effective cache-write weight for the run.
    """
    return (
        input_tokens * cfg.input_weight
        + cache_write * cache_write_weight
        + cache_read * cfg.cache_read_weight
        + output * cfg.output_weight
    )

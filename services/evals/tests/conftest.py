from pathlib import Path

import pytest
from candor_evals.models import GroundTruth, load_truth
from candor_evals.synth import generate


@pytest.fixture(scope="session")
def scenario_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("scenarios")
    generate(directory)
    return directory


@pytest.fixture
def scenario(scenario_root: Path) -> Path:
    return scenario_root / "procurement-kickback"


@pytest.fixture
def truth(scenario: Path) -> GroundTruth:
    return load_truth(scenario)

# RepoCare acceptance checks for the public historical cattrs PR #800.
# SPDX-License-Identifier: Apache-2.0
from dataclasses import dataclass, field
from typing import Union
import pytest
from attrs import define, Factory
from cattrs import Converter
from cattrs.disambiguators import create_default_dis_func

def test_factory_ambiguity_matches_attrs():
    @dataclass
    class D1:
        x: int
        tags: list = field(default_factory=list)
    @dataclass
    class D2:
        x: int
    @define
    class A1:
        x: int
        tags: list = Factory(list)
    @define
    class A2:
        x: int
    for pair in ((A1,A2),(A2,A1),(D1,D2),(D2,D1)):
        with pytest.raises(TypeError, match='Could not disambiguate'):
            create_default_dis_func(Converter(), *pair)

def test_required_unique_field_still_selects_class():
    @dataclass
    class Left:
        x: int
        left: str
    @dataclass
    class Right:
        x: int
        right: str
    dis = create_default_dis_func(Converter(), Left, Right)
    assert dis({'x': 1, 'left': 'a'}) is Left
    assert dis({'x': 1, 'right': 'b'}) is Right

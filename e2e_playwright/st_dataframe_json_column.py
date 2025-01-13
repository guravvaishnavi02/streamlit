# Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import random

import numpy as np
import pandas as pd

import streamlit as st

np.random.seed(0)
random.seed(0)

st.set_page_config(layout="wide")

# Generate a random dataframe
df = pd.DataFrame(
    np.random.randn(5, 5),
    columns=("col_%d" % i for i in range(5)),
)

st.header("JSON column:")

# Dataframe with JSON column
df_json = pd.DataFrame(
    {
        "col_0": [
            '{"foo": "bar", "bar": "baz", "foo": {"foo": {"foo": "bar"}}, "foo1": {"foo": {"foo": "bar"}}, "foo2": {"foo": {"foo": "bar"}}, "foo3": {"foo": {"foo": "bar"}}}',
            '{"foo": "baz", "bar": "qux"}',
            '{"foo": "qux", "bar": "foo"}',
            None,
        ],
        "col_1": [
            {
                # "foo": "bar",
                # "bar": "baz",
                # "foo": {"foo": {"foo": "bar"}},
                # "foo1": {"foo": {"foo": "bar"}},
                # "foo2": {"foo": {"foo": "bar"}},
                # "foo3": {"foo": {"foo": "bar"}},
            },
            {"foo": "baz", "test": "qux"},
            {"foo": "qux", "bar": "foo"},
            {"foo": "qux", "bar": "foo"},
        ],
        # "col_2": [
        #     ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        #     ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        #     ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        #     None,
        # ],
    }
)
st.dataframe(
    df_json,
    column_config={
        # "col_0": st.column_config.JsonColumn(),
        # "col_1": st.column_config.JsonColumn(),
        # "col_2": st.column_config.JsonColumn(),
    },
)
